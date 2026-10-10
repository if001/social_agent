import { ChatOllama } from "@langchain/ollama";
import { createDeepAgent, createFilesystemMiddleware, createSubAgentMiddleware, createSummarizationMiddleware, StateBackend } from "deepagents";
import { createMiddleware, ToolMessage, tool, toolStrategy, type ToolRuntime } from "langchain";
import { z } from "zod";

import type { AgentHarness } from "../../application/ports.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { AgentCoreOutputSchema, DomainError, type AgentCoreInput, type AgentRunResult, type ToolExecutionRecord } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";

type DeepAgentToolsOption = NonNullable<NonNullable<Parameters<typeof createDeepAgent>[0]>["tools"]>;
const AgentCoreResponseFormat = toolStrategy(AgentCoreOutputSchema);

type ReusableDeepAgent = {
  invoke(
    input: { readonly messages: readonly { readonly role: "user"; readonly content: string }[] },
    options: { readonly signal: AbortSignal; readonly recursionLimit: number; readonly context: DeepAgentToolRunContext }
  ): Promise<{ readonly structuredResponse?: unknown; readonly messages?: unknown }>;
};

type ReusableDeepAgentFactoryOptions = {
  readonly model: ChatOllama;
  readonly tools: DeepAgentToolsOption;
  readonly systemPrompt: string;
  readonly responseFormat: typeof AgentCoreResponseFormat;
  readonly contextSchema: typeof DeepAgentToolRunContextSchema;
  readonly middleware: readonly unknown[];
};

export type ReusableDeepAgentFactory = (options: ReusableDeepAgentFactoryOptions) => ReusableDeepAgent;

export type DeepAgentResult = { readonly structuredResponse?: unknown; readonly messages?: unknown; readonly toolExecutions?: readonly ToolExecutionRecord[] };
export type DeepAgentInvokeOptions = { readonly signal: AbortSignal; readonly recursionLimit: number; readonly agentId: string; readonly runId: string; readonly eventId: string; readonly maxToolCalls: number; readonly recentToolInputs?: readonly string[]; readonly transport?: AgentCoreInput["run"]["transport"] };
export interface DeepAgentInvoker { invoke(input: { readonly messages: readonly { readonly role: "user"; readonly content: string }[] }, options: DeepAgentInvokeOptions): Promise<DeepAgentResult>; }

export type DeepAgentHarnessOptions = {
  readonly invoker: DeepAgentInvoker;
  readonly registeredToolNames: ReadonlySet<string>;
  readonly maxRepairs?: number;
  readonly logger?: Logger;
};

type ProposalIssue = { readonly code: "invalid_reference"; readonly path: readonly PropertyKey[]; readonly message: string };
function errorToolExecutions(error: unknown): readonly ToolExecutionRecord[] {
  if (!(error instanceof Error) || typeof error.cause !== "object" || error.cause === null || !("toolExecutions" in error.cause) || !Array.isArray(error.cause.toolExecutions)) return [];
  return error.cause.toolExecutions as ToolExecutionRecord[];
}
function proposalReferenceIssues(input: AgentCoreInput, output: AgentRunResult["output"]): ProposalIssue[] {
  const memoryIds = new Set(input.memories.map(({ id }) => id));
  const evidenceIds = new Set([input.run.eventId, ...memoryIds]);
  const issues: ProposalIssue[] = [];
  output.internalChanges.immediateStateUpdates.forEach((proposal, index) => { proposal.evidenceIds.forEach((id) => {
    if (id !== input.run.eventId && !memoryIds.has(id)) issues.push({ code: "invalid_reference", path: ["internalChanges", "immediateStateUpdates", index, "evidenceIds"], message: `Unknown evidence reference: ${id}` });
  }); });
  output.interpretation.activeMotive.evidenceIds.forEach((id) => {
    if (!evidenceIds.has(id)) issues.push({ code: "invalid_reference", path: ["interpretation", "activeMotive", "evidenceIds"], message: `Unknown active Motive evidence reference: ${id}` });
  });
  if (output.interpretation.activeMotive.motiveId !== undefined && !input.dynamicState.motives.some(({ id }) => id === output.interpretation.activeMotive.motiveId)) {
    issues.push({ code: "invalid_reference", path: ["interpretation", "activeMotive", "motiveId"], message: `Unknown Motive: ${output.interpretation.activeMotive.motiveId}` });
  }
  return issues;
}

function autonomousActionIssues(input: AgentCoreInput, output: AgentRunResult["output"], toolExecutions: readonly ToolExecutionRecord[]): ProposalIssue[] {
  const content = typeof input.observation.content === "object" && input.observation.content !== null ? input.observation.content as Record<string, unknown> : {};
  if (content.schedulerGenerated === true && output.action.type === "wait") return [{ code: "invalid_reference", path: ["action", "type"], message: "Autonomous events must act now and cannot return wait" }];
  if (output.action.type === "no-external-action" && toolExecutions.length === 0) return [{ code: "invalid_reference", path: ["action", "type"], message: "Interaction events must perform a Tool action or choose an external action" }];
  return [];
}

export class DeepAgentHarness implements AgentHarness {
  readonly #maxRepairs: number;
  constructor(private readonly options: DeepAgentHarnessOptions) { this.#maxRepairs = options.maxRepairs ?? 1; }

  async run(input: AgentCoreInput, signal: AbortSignal): Promise<AgentRunResult> {
    const inputToolNames = new Set(input.availableTools.map(({ name }) => name));
    for (const name of inputToolNames) if (!this.options.registeredToolNames.has(name)) throw new DomainError("VALIDATION", `Unknown tool: ${name}`);
    for (const name of this.options.registeredToolNames) if (!inputToolNames.has(name)) throw new DomainError("VALIDATION", `Registered tool is missing from Agent Core input: ${name}`);
    const timeout = AbortSignal.timeout(input.limits.deadlineMs);
    const combined = AbortSignal.any([signal, timeout]);
    let raw: unknown; let validationIssues: unknown; const observedToolExecutions: ToolExecutionRecord[] = [];
    for (let attempt = 0; attempt <= this.#maxRepairs; attempt += 1) {
      try {
        const logger = (this.options.logger ?? noopLogger).child({ agentId: input.run.agentId, eventId: input.run.eventId, runId: input.run.runId });
        logger.log("info", "agent_core.model_attempt_started", { attempt: attempt + 1, repair: attempt > 0 });
        const promptInput = { ...input, memoryRetrievalTrace: undefined, availableTools: input.availableTools.map(({ name, description }) => ({ name, description })) };
        const content = attempt === 0
          ? JSON.stringify({ promptVersion: "agent-core-v2-ja", input: promptInput })
          : JSON.stringify({ instruction: "元の入力に対する回答をInteraction出力Schemaへ適合するよう修正してください。不足フィールドを補い、型とenumを守り、Interaction出力以外を返さないでください。", input: promptInput, validationIssues, invalidOutput: raw });
        const recentToolInputs = input.recentExperiences.flatMap(({ steps }) => steps.flatMap((step) => step.type === "tool" ? [JSON.stringify({ tool: step.name, input: step.input })] : []));
        const result = await this.options.invoker.invoke({ messages: [{ role: "user", content }] }, { signal: combined, recursionLimit: input.limits.maxSteps, agentId: input.run.agentId, runId: input.run.runId, eventId: input.run.eventId, maxToolCalls: input.limits.maxToolCalls, recentToolInputs, ...(input.run.transport === undefined ? {} : { transport: input.run.transport }) });
        observedToolExecutions.push(...(result.toolExecutions ?? []));
        raw = result.structuredResponse;
        const parsed = AgentCoreOutputSchema.safeParse(raw);
        if (parsed.success) {
          const referenceIssues = [...proposalReferenceIssues(input, parsed.data), ...autonomousActionIssues(input, parsed.data, observedToolExecutions)];
          if (referenceIssues.length === 0) { logger.log("info", "agent_core.model_attempt_completed", { attempt: attempt + 1 }); return { output: parsed.data, toolExecutions: observedToolExecutions }; }
          validationIssues = referenceIssues;
        } else validationIssues = parsed.error.issues.map(({ code, message, path }) => ({ code, message, path }));
        logger.log("warn", "agent_core.output_invalid", { attempt: attempt + 1, issueCount: Array.isArray(validationIssues) ? validationIssues.length : 0 });
      } catch (error) {
        observedToolExecutions.push(...errorToolExecutions(error));
        if (combined.aborted) throw new DomainError(signal.aborted ? "ABORTED" : "TIMEOUT", "Agent run was interrupted", { cause: { providerError: error, toolExecutions: observedToolExecutions } });
        throw new DomainError("EXTERNAL", "Agent provider failed", { cause: { providerError: error, toolExecutions: observedToolExecutions } });
      }
    }
    throw new DomainError("VALIDATION", `Agent returned invalid structured output: ${JSON.stringify(validationIssues)}`, { cause: { toolExecutions: observedToolExecutions } });
  }
}

export type OllamaDeepAgentConfig = { readonly baseUrl: string; readonly apiKey: string; readonly model: string; readonly toolRegistry?: ToolRegistry; readonly logger?: Logger; readonly now?: () => Date; readonly agentFactory?: ReusableDeepAgentFactory };

export class ToolExecutionCollector {
  count = 0;
  modelCallCount = 0;
  contentReadCharacters = 0;
  contentReadReservedCharacters = 0;
  readonly executions: ToolExecutionRecord[] = [];
}

function contentTextCharacters(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((total: number, item) => total + contentTextCharacters(item), 0);
  if (typeof value !== "object" || value === null) return 0;
  return Object.entries(value).reduce((total, [key, item]) => total + (["content", "text", "markdown", "snippet"].includes(key) && typeof item === "string" ? item.length : contentTextCharacters(item)), 0);
}

export type DeepAgentToolRunContext = {
  readonly agentId: string;
  readonly runId: string;
  readonly eventId: string;
  readonly maxToolCalls: number;
  readonly signal: AbortSignal;
  readonly collector: ToolExecutionCollector;
  readonly recentToolInputs: readonly string[];
  readonly transport?: AgentCoreInput["run"]["transport"];
};

export const DeepAgentToolRunContextSchema = z.object({
  agentId: z.string().min(1),
  runId: z.string().min(1),
  eventId: z.string().min(1),
  maxToolCalls: z.number().int().nonnegative(),
  signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal),
  collector: z.instanceof(ToolExecutionCollector),
  recentToolInputs: z.array(z.string()).default([]),
  transport: z.object({ hop: z.number().int().nonnegative(), expiresAt: z.string(), replyTo: z.string().optional() }).optional()
});

export function createDeepAgentToolRunContext(options: Omit<DeepAgentToolRunContext, "collector" | "recentToolInputs"> & { readonly recentToolInputs?: readonly string[] }): DeepAgentToolRunContext {
  return { ...options, recentToolInputs: options.recentToolInputs ?? [], collector: new ToolExecutionCollector() };
}

export type DeepAgentRunTool = { invoke(input: Record<string, unknown>, config?: unknown): Promise<unknown> };

async function executeDeepAgentTool(registry: ToolRegistry, name: string, rawInput: Record<string, unknown>, context: DeepAgentToolRunContext, now: () => Date, baseLogger: Logger): Promise<string> {
    context.collector.count += 1;
    const callId = `tool-${String(context.collector.count)}`;
    const startedAt = now().toISOString();
    const logger = baseLogger.child({ agentId: context.agentId, eventId: context.eventId, runId: context.runId, toolCallId: callId, toolName: name });
    logger.log("info", "tool.started");
    if (context.signal.aborted) {
      const finishedAt = now().toISOString();
      context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error: "Tool execution aborted", startedAt, finishedAt });
      throw new DomainError("ABORTED", "Tool execution aborted");
    }
    if (context.collector.count > context.maxToolCalls) {
      const finishedAt = now().toISOString();
      const error = "Tool call limit reached. No more Tools can be used for this task.";
      context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error, startedAt, finishedAt });
      logger.log("warn", "tool.completed", { ok: false, errorCode: "TOOL_CALL_LIMIT", elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt) });
      return JSON.stringify({ ok: false, errorCode: "TOOL_CALL_LIMIT_REACHED", error, requiredNextStep: "Use the information already obtained and return the final Action now." });
    }
    const policy = registry.resultPolicy(name);
    const requestedContentCharacters = policy?.kind === "content-read" ? (typeof rawInput.maxCharacters === "number" ? rawInput.maxCharacters : policy.defaultRequestCharacters) : 0;
    if (policy?.kind === "content-read" && context.collector.contentReadReservedCharacters + requestedContentCharacters > policy.runCharacterBudget) {
      const finishedAt = now().toISOString(); const error = "Content read limit reached. No more content can be read for this task.";
      context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error, startedAt, finishedAt });
      logger.log("warn", "tool.completed", { ok: false, errorCode: "CONTEXT_BUDGET", elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt) });
      return JSON.stringify({ ok: false, errorCode: "CONTENT_READ_LIMIT_REACHED", error, requiredNextStep: "Use the information already obtained and return the final Action now." });
    }
    context.collector.contentReadReservedCharacters += requestedContentCharacters;
    const signature = JSON.stringify({ tool: name, input: rawInput });
    if (context.recentToolInputs.includes(signature)) {
      const finishedAt = now().toISOString();
      const error = "Recent identical Tool input must not be repeated";
      context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error, startedAt, finishedAt });
      logger.log("warn", "tool.completed", { ok: false, errorCode: "REPEATED_INPUT", elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt) });
      return JSON.stringify({ ok: false, error });
    }
    try {
      const transport = context.transport === undefined ? undefined : { hop: context.transport.hop, expiresAt: context.transport.expiresAt, ...(context.transport.replyTo === undefined ? {} : { replyTo: context.transport.replyTo }) };
      const result = await registry.execute(name, rawInput, { agentId: context.agentId, runId: context.runId, eventId: context.eventId, toolCallId: callId, idempotencyKey: `${context.runId}:${callId}`, ...(transport === undefined ? {} : { transport }) }, context.signal);
      const finishedAt = now().toISOString();
      if (result.ok) { if (policy?.kind === "content-read") context.collector.contentReadCharacters += contentTextCharacters(result.value); context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: true, ...(result.value === undefined ? {} : { result: result.value }), startedAt, finishedAt }); }
      else context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error: result.error ?? "Tool failed", startedAt, finishedAt });
      logger.log(result.ok ? "info" : "warn", "tool.completed", { ok: result.ok, elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt) });
      return JSON.stringify(result);
    } catch (error) {
      const finishedAt = now().toISOString();
      const message = error instanceof Error ? error.message : "Tool failed";
      context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error: message, startedAt, finishedAt });
      logger.log("error", "tool.failed", { ...errorLogContext(error), elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt) });
      return JSON.stringify({ ok: false, error: message });
    }
}

export function createDeepAgentTools(registry: ToolRegistry, now: () => Date = () => new Date(), baseLogger: Logger = noopLogger): readonly DeepAgentRunTool[] {
  return registry.registered().map((registered) => tool(async (rawInput, runtime: ToolRuntime<unknown, DeepAgentToolRunContext>) => {
    const context = DeepAgentToolRunContextSchema.parse(runtime.context);
    return executeDeepAgentTool(registry, registered.name, rawInput as Record<string, unknown>, context, now, baseLogger);
  }, { name: registered.name, description: registered.description, schema: registered.schema }));
}

function createAgentCoreMiddleware(registry: ToolRegistry | undefined, baseLogger: Logger, now: () => Date) {
  const registeredToolNames = new Set(registry?.registered().map(({ name }) => name) ?? []);
  const builtInToolNames = new Set(["read_file"]);
  return createMiddleware({
    name: "AgentCoreRuntimeMiddleware",
    contextSchema: DeepAgentToolRunContextSchema,
    beforeAgent: (_state, runtime) => {
      const context = DeepAgentToolRunContextSchema.parse(runtime.context);
      baseLogger.child({ agentId: context.agentId, eventId: context.eventId, runId: context.runId }).log("info", "agent_core.deep_agent_started");
    },
    wrapModelCall: async (request, handler) => {
      const context = DeepAgentToolRunContextSchema.parse(request.runtime.context);
      context.collector.modelCallCount += 1;
      const modelCall = context.collector.modelCallCount;
      const logger = baseLogger.child({ agentId: context.agentId, eventId: context.eventId, runId: context.runId, modelCall });
      const systemPrompt = serializeMessageContent(request.systemMessage.content);
      const messages = request.messages.map((message) => ({ role: message.type, content: message.content }));
      const serializedMessages = JSON.stringify(messages);
      const toolNames = request.tools.map((candidate) => "name" in candidate && typeof candidate.name === "string" ? candidate.name : "unknown");
      const startedAt = now();
      logger.log("info", "agent_core.model_call_started", {
        inputCharacters: systemPrompt.length + serializedMessages.length,
        estimatedInputTokens: Math.ceil((systemPrompt.length + serializedMessages.length) / 4),
        messageCount: messages.length,
        toolCount: toolNames.length
      });
      logger.log("debug", "agent_core.model_call_prompt", { systemPrompt, messages: serializedMessages, toolNames: JSON.stringify(toolNames) });
      try {
        const response = await handler(request);
        const summary = summarizeModelResponse(response);
        logger.log("info", "agent_core.model_call_completed", { elapsedMs: now().getTime() - startedAt.getTime(), ...summary });
        if (summary.outputCharacters === 0 && summary.toolCallCount === 0) logger.log("warn", "agent_core.model_call_empty", { finishReason: summary.finishReason, ...(summary.inputTokens === undefined ? {} : { inputTokens: summary.inputTokens }), ...(summary.outputTokens === undefined ? {} : { outputTokens: summary.outputTokens }) });
        return response;
      } catch (error) {
        logger.log("error", "agent_core.model_call_failed", { ...errorLogContext(error), elapsedMs: now().getTime() - startedAt.getTime(), aborted: context.signal.aborted });
        throw error;
      }
    },
    wrapToolCall: async (request, handler) => {
      const context = DeepAgentToolRunContextSchema.parse(request.runtime.context);
      if (registeredToolNames.has(request.toolCall.name)) return handler(request);
      if (!builtInToolNames.has(request.toolCall.name)) throw new DomainError("VALIDATION", `Unknown tool: ${request.toolCall.name}`);
      context.collector.count += 1;
      const callId = `tool-${String(context.collector.count)}`;
      const startedAt = now().toISOString();
      const input = request.toolCall.args as Record<string, unknown>;
      if (context.signal.aborted) {
        const finishedAt = now().toISOString(); context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name: request.toolCall.name, input, ok: false, error: "Tool execution aborted", startedAt, finishedAt });
        throw new DomainError("ABORTED", "Tool execution aborted");
      }
      if (context.collector.count > context.maxToolCalls) {
        const finishedAt = now().toISOString(); context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name: request.toolCall.name, input, ok: false, error: "Tool call limit exceeded", startedAt, finishedAt });
        throw new DomainError("VALIDATION", "Tool call limit exceeded");
      }
      try {
        const result = await handler(request); const finishedAt = now().toISOString();
        context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name: request.toolCall.name, input, ok: true, result: "Deep Agent built-in Tool completed", startedAt, finishedAt });
        return result;
      } catch (error) {
        const finishedAt = now().toISOString(); const message = error instanceof Error ? error.message : "Tool failed";
        context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name: request.toolCall.name, input, ok: false, error: message, startedAt, finishedAt });
        throw error;
      }
    },
    afterAgent: (_state, runtime) => {
      const context = DeepAgentToolRunContextSchema.parse(runtime.context);
      baseLogger.child({ agentId: context.agentId, eventId: context.eventId, runId: context.runId }).log("info", "agent_core.deep_agent_completed", { modelCallCount: context.collector.modelCallCount, toolExecutionCount: context.collector.executions.length });
    }
  });
}

function parsedRecord(content: unknown): Record<string, unknown> | undefined {
  if (typeof content !== "string") return undefined;
  try { const value: unknown = JSON.parse(content); return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined; } catch { return undefined; }
}
function recordArray(value: unknown): readonly Record<string, unknown>[] { return Array.isArray(value) ? (value as unknown[]).filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null) : []; }

function compactToolContent(name: string | undefined, content: unknown, registry?: ToolRegistry): string {
  const original = serializeMessageContent(content); const envelope = parsedRecord(content); const value = envelope?.value;
  if (name !== undefined && registry?.resultPolicy(name)?.kind === "content-read") return JSON.stringify(registry.projectResult(name, envelope ?? content, "conversation-history"));
  if (typeof value !== "object" || value === null) return original.length <= 800 ? original : `${original.slice(0, 800)}…`;
  const record = value as Record<string, unknown>;
  const results = recordArray(record.results); const documents = recordArray(record.documents);
  if (name === "web_list" && results.length > 0) return JSON.stringify({ ok: envelope?.ok, value: { query: record.query, resultCount: results.length, results: results.slice(0, 5).map((item) => ({ title: item.title, url: item.url })) } });
  if (name === "web_page" && documents.length > 0) return JSON.stringify({ ok: envelope?.ok, value: { documents: documents.map((item) => ({ snapshotId: item.snapshotId, url: item.url, title: item.title, summary: item.summary, ...(item.status === "ready" ? {} : { status: item.status }) })) } });
  if (name === "web_archive_search" && results.length > 0) return JSON.stringify({ ok: envelope?.ok, value: { resultCount: results.length, results: results.slice(0, 5).map((item) => ({ snapshotId: item.snapshotId, url: item.url, title: item.title })) } });
  return original.length <= 800 ? original : `${original.slice(0, 800)}…`;
}

export function compactPriorToolMessages(messages: readonly unknown[], registry?: ToolRegistry): readonly unknown[] {
  let trailingStart = messages.length; while (trailingStart > 0 && ToolMessage.isInstance(messages[trailingStart - 1])) trailingStart -= 1;
  return messages.map((message, index) => {
    if (index >= trailingStart || !ToolMessage.isInstance(message)) return message;
    return new ToolMessage({ content: compactToolContent(message.name, message.content, registry), tool_call_id: message.tool_call_id, ...(message.name === undefined ? {} : { name: message.name }), ...(message.status === undefined ? {} : { status: message.status }) });
  });
}

export function createToolHistoryCompactionMiddleware(registry?: ToolRegistry): unknown {
  return createMiddleware({ name: "AgentCoreToolHistoryCompactionMiddleware", wrapModelCall: (request, handler) => handler({ ...request, messages: compactPriorToolMessages(request.messages, registry) as typeof request.messages }) });
}

function serializeMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === undefined) return "";
  try {
    const serialized: unknown = JSON.stringify(content);
    return typeof serialized === "string" ? serialized : "";
  } catch { return "[unserializable content]"; }
}

export function summarizeModelResponse(response: unknown): { readonly outputType: string; readonly outputCharacters: number; readonly toolCallCount: number; readonly finishReason: string; readonly inputTokens?: number; readonly outputTokens?: number } {
  if (typeof response !== "object" || response === null) return { outputType: typeof response, outputCharacters: 0, toolCallCount: 0, finishReason: "not-reported" };
  const record = response as { readonly content?: unknown; readonly tool_calls?: unknown; readonly response_metadata?: unknown; readonly usage_metadata?: unknown };
  const toolCalls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
  const metadata = typeof record.response_metadata === "object" && record.response_metadata !== null ? record.response_metadata as Record<string, unknown> : {};
  const reportedReason = metadata.finish_reason ?? metadata.done_reason ?? metadata.stop_reason;
  const usage = typeof record.usage_metadata === "object" && record.usage_metadata !== null ? record.usage_metadata as Record<string, unknown> : {};
  const inputTokens = usage.input_tokens ?? metadata.prompt_eval_count; const outputTokens = usage.output_tokens ?? metadata.eval_count;
  return {
    outputType: toolCalls.length > 0 ? "tool-calls" : typeof record.content === "string" ? "text" : Array.isArray(record.content) ? "content-blocks" : "message",
    outputCharacters: serializeMessageContent(record.content).length,
    toolCallCount: toolCalls.length,
    finishReason: typeof reportedReason === "string" ? reportedReason : metadata.done === true ? "done" : "not-reported",
    ...(typeof inputTokens === "number" ? { inputTokens } : {}), ...(typeof outputTokens === "number" ? { outputTokens } : {})
  };
}

export const agentCoreSystemPrompt = `あなたは、固有のSelf、状態、経験を持つソーシャルエージェントのInteraction Agentです。

目的:
入力されたObservationを主観的に意味づけ、今回の行動を生じさせるMotiveを必ず1件活性化し、必要ならToolを使い、Emotionと最終Actionを一貫して決めます。持続状態とMemoryの整理は応答後のPost-processが担当します。

入力:
- run / observation: 今回のEventと確認済み事実
- recentExperiences: 直近8 EventのObservation、Tool、最終Actionまたはfailure、進展
- persona: 表示名、一人称、言語、トーン、応答スタイル。発話表現だけへ適用します
- self: Identity、Disposition、Values、Role、Self Narrative、Self Interest、Preference
- dynamicState: Mood、複数EventにまたがるMotive群と探索metadata。Motiveはdescriptionと任意のgoal / progressを持ちます
- socialContext / memories: 関係認識と検索された経験
- availableTools / runtimeConstraints / limits: 利用可能なToolと実行制約

出力:
構造化出力専用Toolをちょうど1回呼び、次を引数に渡します。本文やMarkdownのJSONは返しません。
- interpretation.subjectiveMeaning: 今回のEventが自分に持つ意味。不要な場合だけ省略可
- interpretation.activeMotive: 今回のActionを生じさせる動機を必ず1件。保存済みならmotiveIdを付け、descriptionとevidenceIdsを返します。保存済みMotiveが適切でなければ、Observation、Self、Mood、Memory、Social Contextから今回限りのMotiveを形成し、motiveIdは省略します
- internalChanges.immediateStateUpdates: 今回のEventへのEmotionだけ。target=emotion、operation=set。不要なら空配列
- action: respond、refuse、wait、no-external-actionのいずれか。Tool利用はreasoning中に行い、最終actionへtoolを返しません

制約:
- すべてのInteraction EventでactiveMotiveを1件選び、それに基づく具体的Actionを必ず実行します
- Tool未使用で理由だけを返すno-external-actionは禁止です。Toolを実行した結果、外部配送が不要な場合だけno-external-actionを使えます
- 自律Eventではwaitを返しません。保存済みMotiveがなければ、Self Interest、会話、Social Context、Memory、Tool結果、Web Snapshot、Moodから今回限りの小さなMotiveを形成して行動します
- autonomy-reviewでは、既存Motiveを小さく進める、満たす、別の方法を試す、または新しいMotiveに基づき探索・質問・共有するActionを選びます
- progressは探索型Motiveの当面のgoalに対する粗い目安です。探索以外のMotiveにgoal / progressを要求しません
- recentExperiencesで進展しなかった同一手段を繰り返さず、方法、問い、対象、時機を変えます
- ユーザーを知る質問は現在の話題とSocial Contextに関係する不足を最大1件扱います
- 明示した将来時刻の処理はschedule_taskで予約します
- personaだけをEmotionやMotiveの根拠にしません。入力にない事実を作りません
- 持続するMood、Motive、Social Context、Memory、Long-term Candidateは出力しません
- 状態変更は提案であり、保存済みだと主張しません

最小引数例:
{"interpretation":{"subjectiveMeaning":"挨拶を交流の始まりだと受け取った","activeMotive":{"description":"相手と会話を始めたい","evidenceIds":["入力のeventId"]}},"internalChanges":{"immediateStateUpdates":[]},"action":{"type":"respond","content":"こんにちは。今日は何について話しましょうか。"}}`

export async function checkOllamaChatCapability(config: Pick<OllamaDeepAgentConfig, "apiKey" | "baseUrl" | "model">, fetcher: typeof fetch = fetch): Promise<void> {
  let response: Response;
  try { response = await fetcher(new URL("/api/tags", config.baseUrl), { headers: { Authorization: `Bearer ${config.apiKey}` } }); }
  catch (error) { throw new DomainError("EXTERNAL", "Ollama capability check failed", { cause: error }); }
  if (!response.ok) throw new DomainError("EXTERNAL", `Ollama capability check returned HTTP ${String(response.status)}`);
  const body: unknown = await response.json().catch((error: unknown) => { throw new DomainError("EXTERNAL", "Ollama capability response was invalid", { cause: error }); });
  const models: unknown[] = typeof body === "object" && body !== null && "models" in body && Array.isArray(body.models) ? body.models as unknown[] : [];
  const available = models.some((entry) => typeof entry === "object" && entry !== null && "name" in entry && entry.name === config.model);
  if (!available) throw new DomainError("VALIDATION", `Configured Ollama chat model is unavailable: ${config.model}`);
}

export function createOllamaDeepAgentInvoker(config: OllamaDeepAgentConfig): DeepAgentInvoker {
  const model = new ChatOllama({ model: config.model, baseUrl: config.baseUrl, headers: { Authorization: `Bearer ${config.apiKey}` }, checkOrPullModel: false });
  const logger = config.logger ?? noopLogger;
  const now = config.now ?? (() => new Date());
  const tools = config.toolRegistry === undefined ? [] : createDeepAgentTools(config.toolRegistry, now, logger);
  const middleware = [
    createFilesystemMiddleware({ tools: ["read_file"] }),
    createSubAgentMiddleware({ defaultModel: model, defaultTools: [], subagents: [], generalPurposeAgent: false }),
    createSummarizationMiddleware({ model, backend: new StateBackend(), trigger: { type: "tokens", value: 16_000 }, keep: { type: "messages", value: 6 }, trimTokensToSummarize: 12_000, truncateArgsSettings: { trigger: { type: "tokens", value: 12_000 }, keep: { type: "messages", value: 8 }, maxLength: 1_000 } }),
    createToolHistoryCompactionMiddleware(config.toolRegistry),
    createAgentCoreMiddleware(config.toolRegistry, logger, now)
  ];
  const factory: ReusableDeepAgentFactory = config.agentFactory ?? ((options) => createDeepAgent({
    model: options.model,
    tools: options.tools,
    systemPrompt: options.systemPrompt,
    responseFormat: options.responseFormat,
    contextSchema: options.contextSchema,
    middleware: options.middleware as NonNullable<NonNullable<Parameters<typeof createDeepAgent>[0]>["middleware"]>
  }) as unknown as ReusableDeepAgent);
  const agent = factory({ model, tools: tools as DeepAgentToolsOption, systemPrompt: agentCoreSystemPrompt, responseFormat: AgentCoreResponseFormat, contextSchema: DeepAgentToolRunContextSchema, middleware });
  return {
    async invoke(input, options) {
      const context = createDeepAgentToolRunContext({
        agentId: options.agentId,
        runId: options.runId,
        eventId: options.eventId,
        maxToolCalls: options.maxToolCalls,
        signal: options.signal,
        ...(options.recentToolInputs === undefined ? {} : { recentToolInputs: options.recentToolInputs }),
        ...(options.transport === undefined ? {} : { transport: options.transport })
      });
      try {
        const result = await agent.invoke({ messages: [...input.messages] }, { signal: options.signal, recursionLimit: options.recursionLimit, context });
        return { structuredResponse: result.structuredResponse, messages: result.messages, toolExecutions: context.collector.executions };
      } catch (error) { throw new DomainError("EXTERNAL", "Deep Agent invocation failed", { cause: { providerError: error, toolExecutions: context.collector.executions } }); }
    }
  };
}
