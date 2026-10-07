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
export type DeepAgentInvokeOptions = { readonly signal: AbortSignal; readonly recursionLimit: number; readonly agentId: string; readonly runId: string; readonly eventId: string; readonly maxToolCalls: number; readonly recentToolInputSummaries?: readonly string[]; readonly transport?: AgentCoreInput["run"]["transport"] };
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
  const issues: ProposalIssue[] = [];
  output.internalChanges.immediateStateUpdates.forEach((proposal, index) => { proposal.evidenceIds.forEach((id) => {
    if (id !== input.run.eventId && !memoryIds.has(id)) issues.push({ code: "invalid_reference", path: ["internalChanges", "immediateStateUpdates", index, "evidenceIds"], message: `Unknown evidence reference: ${id}` });
  }); });
  return issues;
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
        const result = await this.options.invoker.invoke({ messages: [{ role: "user", content }] }, { signal: combined, recursionLimit: input.limits.maxSteps, agentId: input.run.agentId, runId: input.run.runId, eventId: input.run.eventId, maxToolCalls: input.limits.maxToolCalls, recentToolInputSummaries: input.recentAttempts.filter(({ actionType }) => actionType === "tool").map(({ inputSummary }) => inputSummary), ...(input.run.transport === undefined ? {} : { transport: input.run.transport }) });
        observedToolExecutions.push(...(result.toolExecutions ?? []));
        raw = result.structuredResponse;
        const parsed = AgentCoreOutputSchema.safeParse(raw);
        if (parsed.success) {
          const referenceIssues = proposalReferenceIssues(input, parsed.data);
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
  webArchiveTextCharacters = 0;
  webArchiveReservedCharacters = 0;
  readonly executions: ToolExecutionRecord[] = [];
}

const WEB_ARCHIVE_RUN_TEXT_BUDGET = 6_000;
const rawWebArchiveTools = new Set(["web_archive_read", "web_archive_grep"]);
function webArchiveTextCharacters(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const record = value as Record<string, unknown>;
  if (typeof record.text === "string") return record.text.length;
  if (!Array.isArray(record.matches)) return 0;
  return record.matches.reduce((total: number, item: unknown) => total + (typeof item === "object" && item !== null && typeof (item as Record<string, unknown>).text === "string" ? ((item as Record<string, unknown>).text as string).length : 0), 0);
}

export type DeepAgentToolRunContext = {
  readonly agentId: string;
  readonly runId: string;
  readonly eventId: string;
  readonly maxToolCalls: number;
  readonly signal: AbortSignal;
  readonly collector: ToolExecutionCollector;
  readonly recentToolInputSummaries: readonly string[];
  readonly transport?: AgentCoreInput["run"]["transport"];
};

export const DeepAgentToolRunContextSchema = z.object({
  agentId: z.string().min(1),
  runId: z.string().min(1),
  eventId: z.string().min(1),
  maxToolCalls: z.number().int().nonnegative(),
  signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal),
  collector: z.instanceof(ToolExecutionCollector),
  recentToolInputSummaries: z.array(z.string()).default([]),
  transport: z.object({ hop: z.number().int().nonnegative(), expiresAt: z.string(), replyTo: z.string().optional() }).optional()
});

export function createDeepAgentToolRunContext(options: Omit<DeepAgentToolRunContext, "collector" | "recentToolInputSummaries"> & { readonly recentToolInputSummaries?: readonly string[] }): DeepAgentToolRunContext {
  return { ...options, recentToolInputSummaries: options.recentToolInputSummaries ?? [], collector: new ToolExecutionCollector() };
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
      context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error: "Tool call limit exceeded", startedAt, finishedAt });
      throw new DomainError("VALIDATION", "Tool call limit exceeded");
    }
    const requestedWebArchiveCharacters = rawWebArchiveTools.has(name) ? (typeof rawInput.maxCharacters === "number" ? rawInput.maxCharacters : 2_000) : 0;
    if (requestedWebArchiveCharacters > 0 && context.collector.webArchiveReservedCharacters + requestedWebArchiveCharacters > WEB_ARCHIVE_RUN_TEXT_BUDGET) {
      const finishedAt = now().toISOString(); const error = `Web archive text budget exceeded (${String(WEB_ARCHIVE_RUN_TEXT_BUDGET)} characters per run)`;
      context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error, startedAt, finishedAt });
      logger.log("warn", "tool.completed", { ok: false, errorCode: "CONTEXT_BUDGET", elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt) });
      return JSON.stringify({ ok: false, error });
    }
    context.collector.webArchiveReservedCharacters += requestedWebArchiveCharacters;
    const signature = JSON.stringify({ tool: name, input: rawInput });
    if (context.recentToolInputSummaries.some((summary) => summary.includes(signature))) {
      const finishedAt = now().toISOString();
      context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error: "Recent identical Tool input must not be repeated", startedAt, finishedAt });
      throw new DomainError("CONFLICT", "Recent identical Tool input must not be repeated");
    }
    try {
      const transport = context.transport === undefined ? undefined : { hop: context.transport.hop, expiresAt: context.transport.expiresAt, ...(context.transport.replyTo === undefined ? {} : { replyTo: context.transport.replyTo }) };
      const result = await registry.execute(name, rawInput, { agentId: context.agentId, runId: context.runId, eventId: context.eventId, toolCallId: callId, idempotencyKey: `${context.runId}:${callId}`, ...(transport === undefined ? {} : { transport }) }, context.signal);
      const finishedAt = now().toISOString();
      if (result.ok) { if (rawWebArchiveTools.has(name)) context.collector.webArchiveTextCharacters += webArchiveTextCharacters(result.value); context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: true, ...(result.value === undefined ? {} : { result: result.value }), startedAt, finishedAt }); }
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

function compactToolContent(name: string | undefined, content: unknown): string {
  const original = serializeMessageContent(content); const envelope = parsedRecord(content); const value = envelope?.value;
  if (typeof value !== "object" || value === null) return original.length <= 800 ? original : `${original.slice(0, 800)}…`;
  const record = value as Record<string, unknown>;
  const results = recordArray(record.results); const documents = recordArray(record.documents);
  if (name === "web_list" && results.length > 0) return JSON.stringify({ ok: envelope?.ok, value: { query: record.query, resultCount: results.length, results: results.slice(0, 5).map((item) => ({ title: item.title, url: item.url })) } });
  if (name === "web_page" && documents.length > 0) return JSON.stringify({ ok: envelope?.ok, value: { documents: documents.map((item) => ({ snapshotId: item.snapshotId, url: item.url, title: item.title, summary: item.summary, ...(item.status === "ready" ? {} : { status: item.status }) })) } });
  if (name === "web_archive_search" && results.length > 0) return JSON.stringify({ ok: envelope?.ok, value: { resultCount: results.length, results: results.slice(0, 5).map((item) => ({ snapshotId: item.snapshotId, url: item.url, title: item.title })) } });
  if (name === "web_archive_read") return JSON.stringify({ ok: envelope?.ok, value: { snapshotId: record.snapshotId, offset: record.offset, textCharacters: typeof record.text === "string" ? record.text.length : 0, truncated: record.truncated } });
  if (name === "web_archive_grep") return JSON.stringify({ ok: envelope?.ok, value: { snapshotId: record.snapshotId, matchCount: Array.isArray(record.matches) ? record.matches.length : 0, truncated: record.truncated } });
  return original.length <= 800 ? original : `${original.slice(0, 800)}…`;
}

export function compactPriorToolMessages(messages: readonly unknown[]): readonly unknown[] {
  let trailingStart = messages.length; while (trailingStart > 0 && ToolMessage.isInstance(messages[trailingStart - 1])) trailingStart -= 1;
  return messages.map((message, index) => {
    if (index >= trailingStart || !ToolMessage.isInstance(message)) return message;
    return new ToolMessage({ content: compactToolContent(message.name, message.content), tool_call_id: message.tool_call_id, ...(message.name === undefined ? {} : { name: message.name }), ...(message.status === undefined ? {} : { status: message.status }) });
  });
}

export function createToolHistoryCompactionMiddleware(): unknown {
  return createMiddleware({ name: "AgentCoreToolHistoryCompactionMiddleware", wrapModelCall: (request, handler) => handler({ ...request, messages: compactPriorToolMessages(request.messages) as typeof request.messages }) });
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

export const agentCoreSystemPrompt = `あなたは、固有の状態と経験を持つソーシャルエージェントのInteraction Agentです。

目的:
入力されたObservationを既存状態と経験に照らして意味づけ、必要ならToolを使い、その場のEmotion・Desireと最終行動を一貫して決めます。持続状態やMemoryの整理は応答後のPost-processが担当します。

入力:
- run: run、Event、対象Agent、発生時刻
- observation: 今回観測した出来事と確認済みの事実
- recentObservations: 代名詞や省略を解決するための直近の出来事。新しい出来事として重複保存しません
- recentAttempts: 現在の関心に利用できる直近の質問・Tool・待機等の試行要約と結果、時刻、progress変化。履歴の正本ではなく有界な判断材料です
- persona: 設定された表示名、一人称、言語、トーン、応答スタイル。発話表現だけへ適用し、意味判断、行動選択、内部状態、長期的なSelfの根拠にはしません。省略される場合があります
- self: Identity、3種類のDisposition（Family共通のshared、個体初期値のinitial、経験から形成されたacquired）、Values、Role、Self Narrative、Self Continuity。Dispositionは制約ではなく、出来事の意味づけと価値判断の傾向です
- dynamicState: 次のEventにも継続しているMood、複数のDrive（description、sourceEvidenceIds、since）、Current Interest（id、question、goal、progress）、探索metadata。前回EventのEmotionとDesireは含みません
- socialContext: 対象Agentが持つ関係認識
- memories: 今回の判断に利用できる対象Agent自身のMemory
- intentions: 継続中の行動方針。Expectationは独立保存せず、これとSocial Context、Memory、直近Observationから今回予期していたことと実際との差を導出します
- availableTools: このrunで利用可能なTool
- runtimeConstraintsとlimits: 必ず守る実行制約

最終出力は、提供された構造化出力専用Toolをちょうど1回呼び出し、その引数として次のInteraction出力を渡します。通常の本文やMarkdownのJSONとして返しません:
- interpretation.subjectiveMeaning: 今回のEventがこのAgentにとって持つ意味。意味づけが不要な場合だけ省略できます
- internalChanges.immediateStateUpdates: 今回の応答判断に直接関係するEmotionとDesireだけの更新提案。targetはemotionまたはdesiresです。Emotionはset、Desireはset | append | removeを使い、value、reason、evidenceIdsを持ちます。不要なら空配列にします
- action: respondはcontent、waitはreasonと任意のuntil、refuseはreasonとbasis（personality | system）、no-actionはreasonを持ちます。Tool利用はreasoning中に行い、最終actionへtoolを返しません

時間スケール:
- Emotionと各Desireは今回のEventに対する短期状態であり、次回入力には引き継がれません
- Mood、Drive、Current Interest、Social Context、Memory、Intention、Long-term Candidateは出力しません

制約:
- personaがある場合はrespondの表現へ反映します。personaだけを根拠にEmotionやDesireを提案しません
- 入力にない事実を作りません
- 他Agentから聞いた情報を対象Agent自身の直接経験として扱いません
- 全状態を毎回変更せず、不要ならimmediateStateUpdatesは空配列[]にします
- 状態変更は提案であり、保存済みだと主張しません
- schedulerGenerated=trueのInternal Eventでは、targetKindに応じて自律的な再検討を行います。Driveは「なぜ」、Current Interestは「何について」、Intentionは「後で具体的に何をするか」を表します。persistent-driveは「なぜ求めるか」を該当Driveの根拠とSelfに照らします。autonomy-reviewは現在関心へ注意を向けられるInternal Observationです。Drive、Current Interest、Intentionが空でも、self.interests / preferences、最近のObservationとMemory、探索metadataから具体的なKnowledge Gapを最大1件選び、一時的DesireとしてTool、ユーザーへの質問、wait、no-actionを判断できます。Stable Interestをそのまま永続Driveに変換しません
- autonomy-reviewでStable Interestがあり、同じテーマの最近の探索、cooldown、優先すべき依頼がない場合は、そのInterestについてまだ予測・説明できない具体的な問いを1件作り、利用可能なToolで小さく調べるか、Toolがなければ後で調べる理由を伴うwaitを選びます。Drive、Current Interest、Intentionが空であることだけをno-actionの理由にしません
- recentAttemptsで進展しなかった質問やTool入力を同じ形で繰り返しません。同じGoalを追うなら、質問を具体化する、自分の関心や質問理由を先に共有する、検索語・Tool・対象を変える、または別の時機までwaitする、のいずれかを選びます。別手段でも進展が期待できなければno-actionにします
- ユーザーを知るための質問は、固定の質問順序を使わず、現在の話題とSocial Contextに関係するKnowledge Gapを最大1件だけ扱います。無応答や話題変更を常に拒否と決めつけません
- cooldownUntilが未来のCurrent Interestは再探索しません。同じ検索や外部通知を繰り返さず、探索途中や弱い進展はrespondせず内部保存のためのno-actionを選びます。ユーザーの進行中の関心に有用な発見、重要な発見、ユーザーに尋ねなければ埋まらないKnowledge Gapだけrespondできます
- 自律Eventでは、今すぐ応答またはToolで行動する、後で行うIntentionの材料としてwaitする、対象が解消していればno-actionにする、今回は延期する、のいずれかを根拠とともに選びます。Toolは確認が必要で結果を利用できる場合だけ使い、同じ関心の反復検索や弱い根拠による外部通知を避けます
- 自律Eventで外部へ伝える価値がなければrespondを選ばず、waitまたはno-actionにします。Tool結果は出典を区別し、Web検索結果の重要な経験は応答後のMemory Extractionが要約できる形で最終判断へ反映します
- 最終回答では通常の説明文を返さず、構造化出力専用Toolだけを呼び出します

構造化出力専用Toolへ渡す最小引数例:
{"interpretation":{"subjectiveMeaning":"挨拶を受け、穏やかな交流の始まりだと受け取った"},"internalChanges":{"immediateStateUpdates":[]},"action":{"type":"respond","content":"こんにちは。今日は何について話しましょうか。"}}`;

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
    createToolHistoryCompactionMiddleware(),
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
        ...(options.recentToolInputSummaries === undefined ? {} : { recentToolInputSummaries: options.recentToolInputSummaries }),
        ...(options.transport === undefined ? {} : { transport: options.transport })
      });
      try {
        const result = await agent.invoke({ messages: [...input.messages] }, { signal: options.signal, recursionLimit: options.recursionLimit, context });
        return { structuredResponse: result.structuredResponse, messages: result.messages, toolExecutions: context.collector.executions };
      } catch (error) { throw new DomainError("EXTERNAL", "Deep Agent invocation failed", { cause: { providerError: error, toolExecutions: context.collector.executions } }); }
    }
  };
}
