import { agentCoreSystemPrompt } from "./deep-agent-prompt.js";
import { createAgentCoreMiddleware } from "./deep-agent-middleware.js";
import { createToolHistoryCompactionMiddleware } from "./tool-history.js";
import { createDeepAgentTools, createDeepAgentToolRunContext, DeepAgentToolRunContextSchema, type DeepAgentToolRunContext } from "./deep-agent-tools.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { createDeepAgent, createFilesystemMiddleware, createSubAgentMiddleware, createSummarizationMiddleware, StateBackend } from "deepagents";
import { toolStrategy, type TypedToolStrategy } from "langchain";
import { z } from "zod";

import type { AgentHarness } from "../../application/ports.js";
import { estimateTokens } from "../../application/context-builder.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { AgentCoreOutputSchema, DomainError, type AgentCoreInput, type AgentRunResult, type ToolExecutionRecord } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";

type DeepAgentToolsOption = NonNullable<NonNullable<Parameters<typeof createDeepAgent>[0]>["tools"]>;
type AgentCoreResponseFormat = TypedToolStrategy<z.infer<typeof AgentCoreOutputSchema>>;

type ReusableDeepAgent = {
  invoke(
    input: { readonly messages: readonly { readonly role: "user"; readonly content: string }[] },
    options: { readonly signal: AbortSignal; readonly recursionLimit: number; readonly context: DeepAgentToolRunContext }
  ): Promise<{ readonly structuredResponse?: unknown; readonly messages?: unknown }>;
};

type ReusableDeepAgentFactoryOptions = {
  readonly model: ReturnType<typeof createOllamaChatModel>;
  readonly tools: DeepAgentToolsOption;
  readonly systemPrompt: string;
  readonly responseFormat: AgentCoreResponseFormat;
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

export const MAX_MODEL_INPUT_TOKENS = 6_000;
export function modelInputBudget(input: AgentCoreInput, content: string): { readonly total: number; readonly components: Readonly<Record<string, number>> } {
  const components = {
    systemPrompt: estimateTokens(agentCoreSystemPrompt),
    messages: estimateTokens([{ role: "user", content }]),
    tools: estimateTokens(input.availableTools),
    outputSchema: estimateTokens(z.toJSONSchema(AgentCoreOutputSchema))
  };
  return { total: Object.values(components).reduce((sum, value) => sum + value, 0), components };
}

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

function actionExecutionIssues(output: AgentRunResult["output"], toolExecutions: readonly ToolExecutionRecord[]): ProposalIssue[] {
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
        const modelBudget = modelInputBudget(input, content);
        if (modelBudget.total > MAX_MODEL_INPUT_TOKENS) throw new DomainError("LIMIT_EXCEEDED", `Model input exceeds ${String(MAX_MODEL_INPUT_TOKENS)} tokens: ${JSON.stringify(modelBudget.components)}`);
        const recentToolInputs = input.recentExperiences.flatMap(({ steps }) => steps.flatMap((step) => step.type === "tool" ? [JSON.stringify({ tool: step.name, input: step.input })] : []));
        const result = await this.options.invoker.invoke({ messages: [{ role: "user", content }] }, { signal: combined, recursionLimit: input.limits.maxSteps, agentId: input.run.agentId, runId: input.run.runId, eventId: input.run.eventId, maxToolCalls: input.limits.maxToolCalls, recentToolInputs, ...(input.run.transport === undefined ? {} : { transport: input.run.transport }) });
        observedToolExecutions.push(...(result.toolExecutions ?? []));
        raw = result.structuredResponse;
        const parsed = AgentCoreOutputSchema.safeParse(raw);
        if (parsed.success) {
          const referenceIssues = [...proposalReferenceIssues(input, parsed.data), ...actionExecutionIssues(parsed.data, observedToolExecutions)];
          if (referenceIssues.length === 0) { logger.log("info", "agent_core.model_attempt_completed", { attempt: attempt + 1 }); return { output: parsed.data, toolExecutions: observedToolExecutions }; }
          validationIssues = referenceIssues;
        } else validationIssues = parsed.error.issues.map(({ code, message, path }) => ({ code, message, path }));
        logger.log("warn", "agent_core.output_invalid", { attempt: attempt + 1, issueCount: Array.isArray(validationIssues) ? validationIssues.length : 0 });
      } catch (error) {
        observedToolExecutions.push(...errorToolExecutions(error));
        throw providerFailure("Agent", error, combined, { providerError: error, toolExecutions: observedToolExecutions });
      }
    }
    throw new DomainError("VALIDATION", `Agent returned invalid structured output: ${JSON.stringify(validationIssues)}`, { cause: { toolExecutions: observedToolExecutions } });
  }
}

export type OllamaDeepAgentConfig = OllamaChatConfig & { readonly toolRegistry?: ToolRegistry; readonly logger?: Logger; readonly now?: () => Date; readonly agentFactory?: ReusableDeepAgentFactory };

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
  const model = createOllamaChatModel(config);
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
  const agent = factory({ model, tools: tools as DeepAgentToolsOption, systemPrompt: agentCoreSystemPrompt, responseFormat: toolStrategy(AgentCoreOutputSchema, { handleError: (error) => {
    logger.log("warn", "agent_core.structured_output_invalid", errorLogContext(error));
    return "構造化出力が不正です。通常Toolは使わず、指定Schemaの全フィールドを含む最終回答を構造化出力専用Toolでちょうど1件だけ返してください。検証エラー: " + error.message;
  } }), contextSchema: DeepAgentToolRunContextSchema, middleware });
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
      context.collector.explorationModelCalls = Math.max(1, Math.min(3, Math.floor(options.recursionLimit / 4)));
      try {
        const result = await agent.invoke({ messages: [...input.messages] }, { signal: options.signal, recursionLimit: Math.max(64, options.recursionLimit), context });
        return { structuredResponse: result.structuredResponse, messages: result.messages, toolExecutions: context.collector.executions };
      } catch (error) { throw new DomainError("EXTERNAL", "Deep Agent invocation failed", { cause: { providerError: error, toolExecutions: context.collector.executions } }); }
    }
  };
}
