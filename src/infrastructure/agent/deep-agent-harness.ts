import { agentCoreSystemPrompt } from "./deep-agent-prompt.js";
import { autonomousExplorationPrompt } from "./autonomous-exploration-prompt.js";
import { concernLifecyclePrompt } from "./concern-lifecycle-prompt.js";
import { createAgentCoreMiddleware } from "./deep-agent-middleware.js";
import { createDeepAgentTools, createDeepAgentToolRunContext, DeepAgentToolRunContextSchema, type DeepAgentToolRunContext } from "./deep-agent-tools.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { createDeepAgent } from "deepagents";
import { SystemMessage, toolStrategy, type TypedToolStrategy } from "langchain";
import { z } from "zod";

import type { AgentHarness } from "../../application/ports.js";
import { estimateTokens } from "../../application/context-builder.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { AgentCoreOutputSchema, DomainError, EventAssessmentSchema, type AgentCoreInput, type AgentRunResult, type EventAssessment, type ToolExecutionRecord } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";

type DeepAgentToolsOption = NonNullable<NonNullable<Parameters<typeof createDeepAgent>[0]>["tools"]>;

const AgentCoreFlatOutputSchema = z.object({
  desire: z.string().trim().min(1).max(16_000).describe("今回のEventを受けて今具体的に望むこと"),
  actionType: z.enum(["respond", "refuse", "notify-no-execution", "no-external-action"]).describe("今回確定するAction。通常応答はrespond、自律Eventで実行しない通知はnotify-no-execution、Toolだけで完了した場合だけno-external-action"),
  content: z.string().trim().min(1).max(16_000).optional().describe("respond、refuse、notify-no-executionで相手へ配送する本文。それらのActionでは必須"),
  reason: z.string().trim().min(1).max(16_000).optional().describe("refuse、notify-no-execution、no-external-actionの内部理由。それらのActionでは必須"),
  refusalBasis: z.enum(["personality", "system"]).optional().describe("refuseの根拠。refuseの場合だけ必須"),
  mood: z.string().trim().min(1).max(16_000).optional().describe("次のEventにも残す気分。変化がある場合だけ指定"),
  concernOperation: z.enum(["upsert", "remove"]).optional().describe("Concernを変更する場合の操作。変更しない場合は省略"),
  concernId: z.string().min(1).optional().describe("変更するConcernのID。concernOperation指定時は必須"),
  concernDescription: z.string().trim().min(1).max(16_000).optional().describe("追加または更新するConcernの内容。concernOperationがupsertの場合は必須"),
  concernWhyItMatters: z.string().trim().min(1).max(16_000).optional().describe("Concernが現在のSelfにとって重要な理由。concernOperationがupsertの場合は必須"),
  concernStatus: z.enum(["active", "satisfied", "abandoned"]).optional().describe("Concernの状態。concernOperationがupsertの場合は必須"),
  concernReconsiderAt: z.string().optional().describe("Concernを再検討するISO 8601日時。明確な将来時刻がある場合だけ指定"),
  relationshipOperation: z.enum(["upsert", "remove"]).optional().describe("Relationshipを変更する場合の操作。変更しない場合は省略"),
  relationshipSubjectId: z.string().min(1).optional().describe("Relationshipの相手ID。relationshipOperation指定時は必須"),
  relationshipDescription: z.string().trim().min(1).max(16_000).optional().describe("現在の関係性。relationshipOperationがupsertの場合は必須"),
  remember: z.string().trim().min(1).max(800).optional().describe("今回すぐ記憶候補に残す要点。会話やTool結果を転載せず、長期的価値がある内容を1〜2文で指定")
}).strict().describe("Agent Coreの最終判断。必要なActionフィールドだけを埋め、状態変更がなければ状態フィールドを省略する");
export const completeAgentCoreSystemPrompt = `${agentCoreSystemPrompt}${autonomousExplorationPrompt}${concernLifecyclePrompt}`;
type AgentCoreResponseFormat = TypedToolStrategy<z.infer<typeof AgentCoreFlatOutputSchema>>;

export const AgentCoreModelOutputJsonSchema = modelJsonSchema(AgentCoreFlatOutputSchema);

function domainOutputFromFlat(value: unknown): unknown {
  const parsed = AgentCoreFlatOutputSchema.safeParse(value);
  if (!parsed.success) return value;
  const flat = parsed.data;
  const action = flat.actionType === "respond" ? { type: flat.actionType, content: flat.content }
    : flat.actionType === "refuse" ? { type: flat.actionType, content: flat.content, reason: flat.reason, basis: flat.refusalBasis }
      : flat.actionType === "notify-no-execution" ? { type: flat.actionType, content: flat.content, reason: flat.reason }
        : { type: flat.actionType, reason: flat.reason };
  const concern = flat.concernOperation === "upsert"
    ? { operation: flat.concernOperation, concern: { id: flat.concernId, description: flat.concernDescription, whyItMatters: flat.concernWhyItMatters, status: flat.concernStatus, ...(flat.concernReconsiderAt === undefined ? {} : { reconsiderAt: flat.concernReconsiderAt }) } }
    : flat.concernOperation === "remove" ? { operation: flat.concernOperation, id: flat.concernId } : undefined;
  const relationship = flat.relationshipOperation === "upsert"
    ? { operation: flat.relationshipOperation, relationship: { subjectId: flat.relationshipSubjectId, description: flat.relationshipDescription } }
    : flat.relationshipOperation === "remove" ? { operation: flat.relationshipOperation, subjectId: flat.relationshipSubjectId } : undefined;
  const hasPatch = flat.mood !== undefined || concern !== undefined || relationship !== undefined || flat.remember !== undefined;
  return { desire: flat.desire, action, ...(hasPatch ? { patch: { ...(flat.mood === undefined ? {} : { mood: flat.mood }), ...(concern === undefined ? {} : { concern }), ...(relationship === undefined ? {} : { relationship }), ...(flat.remember === undefined ? {} : { remember: flat.remember }) } } : {}) };
}

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

export type DeepAgentResult = { readonly structuredResponse?: unknown; readonly messages?: unknown; readonly toolExecutions?: readonly ToolExecutionRecord[]; readonly modelCalls?: number };
export type { EventAssessment } from "../../domain/contracts.js";
export type DeepAgentInvokeOptions = { readonly signal: AbortSignal; readonly recursionLimit: number; readonly maxModelCalls: number; readonly agentId: string; readonly runId: string; readonly eventId: string; readonly maxToolCalls: number; readonly recentToolInputs?: readonly string[]; readonly transport?: AgentCoreInput["run"]["transport"] };
export interface DeepAgentInvoker {
  assess?(input: { readonly messages: readonly { readonly role: "user"; readonly content: string }[] }, options: DeepAgentInvokeOptions): Promise<{ readonly assessment: EventAssessment; readonly modelCalls: number }>;
  invoke(input: { readonly messages: readonly { readonly role: "user"; readonly content: string }[] }, options: DeepAgentInvokeOptions): Promise<DeepAgentResult>;
}

export type DeepAgentHarnessOptions = {
  readonly invoker: DeepAgentInvoker;
  readonly registeredToolNames: ReadonlySet<string>;
  readonly maxRepairs?: number;
  readonly logger?: Logger;
};

// ContextBuilder may retain 4,500 tokens of Agent context. Production Tool
// schemas and the system/final-action contracts require roughly 3,500 more.
export const MAX_MODEL_INPUT_TOKENS = 8_000;
type ModelCallBudget = { readonly total: number; readonly components: Readonly<Record<string, number>> };
export function modelCallInputBudget(messages: readonly unknown[], tools: readonly unknown[]): ModelCallBudget {
  // Concrete calls receive the final Action schema as a bound Tool. Counting it
  // again as an output schema rejects valid inputs without reflecting provider usage.
  const components = { messages: estimateTokens(messages), tools: estimateTokens(tools) };
  return { total: Object.values(components).reduce((sum, value) => sum + value, 0), components };
}
export function modelInputBudget(input: AgentCoreInput, content: string): { readonly total: number; readonly components: Readonly<Record<string, number>> } {
  const components = {
    systemPrompt: estimateTokens(completeAgentCoreSystemPrompt),
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
function errorModelCalls(error: unknown): number {
  if (!(error instanceof Error) || typeof error.cause !== "object" || error.cause === null || !("modelCalls" in error.cause) || typeof error.cause.modelCalls !== "number") return 0;
  return error.cause.modelCalls;
}
function actionExecutionIssues(output: AgentRunResult["output"], toolExecutions: readonly ToolExecutionRecord[]): ProposalIssue[] {
  if (output.action.type === "no-external-action" && !toolExecutions.some(({ ok }) => ok)) return [{ code: "invalid_reference", path: ["action", "type"], message: toolExecutions.length === 0 ? "Interaction events must perform a Tool action or choose an external action" : "Failed Tool executions do not justify no-external-action; explain, ask, or choose another action" }];
  return [];
}

const USER_RESPONSE_FALLBACK = "申し訳ありません。応答の形式を処理できませんでした。もう一度お試しください。";
function recoverUserStringAction(raw: unknown, input: AgentCoreInput): AgentRunResult["output"] | undefined {
  if (input.observation.kind !== "user-message" || typeof raw !== "object" || raw === null || !("action" in raw) || typeof raw.action !== "string") return undefined;
  const actionText = raw.action.trim();
  let action: unknown;
  if (actionText.startsWith("{")) {
    try { action = JSON.parse(actionText); } catch { action = undefined; }
  }
  if (action === undefined) {
    const content = actionText.length === 0 || ["respond", "response", "reply"].includes(actionText.toLowerCase()) ? USER_RESPONSE_FALLBACK : actionText;
    action = { type: "respond", content };
  }
  const recovered = AgentCoreOutputSchema.safeParse({ ...raw, action });
  return recovered.success ? recovered.data : undefined;
}

export class DeepAgentHarness implements AgentHarness {
  readonly #maxRepairs: number;
  constructor(private readonly options: DeepAgentHarnessOptions) { this.#maxRepairs = options.maxRepairs ?? 0; }

  async run(input: AgentCoreInput, signal: AbortSignal): Promise<AgentRunResult> {
    const inputToolNames = new Set(input.availableTools.map(({ name }) => name));
    for (const name of inputToolNames) if (!this.options.registeredToolNames.has(name)) throw new DomainError("VALIDATION", `Unknown tool: ${name}`);
    for (const name of this.options.registeredToolNames) if (!inputToolNames.has(name)) throw new DomainError("VALIDATION", `Registered tool is missing from Agent Core input: ${name}`);
    const timeout = AbortSignal.timeout(input.limits.deadlineMs);
    const combined = AbortSignal.any([signal, timeout]);
    let raw: unknown; let validationIssues: unknown; const observedToolExecutions: ToolExecutionRecord[] = []; let consumedModelCalls = 0; let currentEventAssessment: EventAssessment | undefined;
    const maxAttempts = this.#maxRepairs + 1;
    const budgetResult = (modelCalls: number, repairs: number) => ({ limits: { deadlineMs: input.limits.deadlineMs, maxSteps: input.limits.maxSteps, maxToolCalls: input.limits.maxToolCalls }, consumed: { modelCalls, toolCalls: observedToolExecutions.length, repairs } });
    if (this.options.invoker.assess !== undefined) {
      const assessmentContent = JSON.stringify({ promptVersion: "event-assessment-v2-ja", input: { observation: input.observation, currentSelf: input.currentSelf, state: input.state, memories: input.memories } });
      const assessed = await this.options.invoker.assess({ messages: [{ role: "user", content: assessmentContent }] }, { signal: combined, recursionLimit: input.limits.maxSteps, maxModelCalls: input.limits.maxSteps, agentId: input.run.agentId, runId: input.run.runId, eventId: input.run.eventId, maxToolCalls: 0 });
      consumedModelCalls += assessed.modelCalls;
      currentEventAssessment = assessed.assessment;
    }
    for (let attempt = 0; attempt < maxAttempts && consumedModelCalls < input.limits.maxSteps; attempt += 1) {
      try {
        const logger = (this.options.logger ?? noopLogger).child({ agentId: input.run.agentId, eventId: input.run.eventId, runId: input.run.runId });
        logger.log("info", "agent_core.model_attempt_started", { attempt: attempt + 1, repair: attempt > 0 });
        const promptInput = { ...input, memoryRetrievalTrace: undefined, availableTools: undefined, currentEventAssessment };
        const content = attempt === 0
          ? JSON.stringify({ promptVersion: "agent-core-v2-ja", input: promptInput })
          : JSON.stringify({ instruction: "無効な出力をAgent Coreのフラット出力Schemaへ適合するよう修正してください。通常Toolは呼ばず、構造化出力専用Toolを1件だけ呼び出してください。action objectは出力せず、actionTypeと、そのActionに必要なcontent、reason、refusalBasisだけをトップレベルへ出力してください。状態変更がなければ状態フィールドは省略してください。入力Contextを推測せず、許可されたevidence IDだけを使ってください。", allowedEvidenceIds: [input.run.eventId, ...input.memories.map(({ id }) => id)], outputSchema: AgentCoreModelOutputJsonSchema, validationIssues, invalidOutput: raw });
        const modelBudget = modelInputBudget(input, content);
        if (modelBudget.total > MAX_MODEL_INPUT_TOKENS) logger.log("warn", "agent_core.model_input_budget_exceeded", { estimatedTokens: modelBudget.total, warningThreshold: MAX_MODEL_INPUT_TOKENS, budgetComponents: JSON.stringify(modelBudget.components) });
        const recentToolInputs = input.recentExperiences.flatMap(({ steps }) => steps.flatMap((step) => step.type === "tool" ? [JSON.stringify({ tool: step.name, input: step.input })] : []));
        const remainingModelCalls = input.limits.maxSteps - consumedModelCalls;
        const result = await this.options.invoker.invoke({ messages: [{ role: "user", content }] }, { signal: combined, recursionLimit: input.limits.maxSteps, maxModelCalls: remainingModelCalls, agentId: input.run.agentId, runId: input.run.runId, eventId: input.run.eventId, maxToolCalls: attempt === 0 ? input.limits.maxToolCalls : 0, recentToolInputs, ...(input.run.transport === undefined ? {} : { transport: input.run.transport }) });
        const invokedModelCalls = result.modelCalls ?? 1;
        if (invokedModelCalls > remainingModelCalls) throw new DomainError("LIMIT_EXCEEDED", "Invoker exceeded the model call budget", { cause: { modelCalls: invokedModelCalls, toolExecutions: result.toolExecutions ?? [] } });
        consumedModelCalls += invokedModelCalls;
        observedToolExecutions.push(...(result.toolExecutions ?? []));
        raw = result.structuredResponse;
        const parsed = AgentCoreOutputSchema.safeParse(raw);
        if (parsed.success) {
          const referenceIssues = actionExecutionIssues(parsed.data, observedToolExecutions);
          if (referenceIssues.length === 0) { logger.log("info", "agent_core.model_attempt_completed", { attempt: attempt + 1, modelCalls: consumedModelCalls, maxToolCalls: input.limits.maxToolCalls }); return { ...(currentEventAssessment === undefined ? {} : { assessment: currentEventAssessment }), output: parsed.data, toolExecutions: observedToolExecutions, budget: budgetResult(consumedModelCalls, attempt) }; }
          validationIssues = referenceIssues;
        } else validationIssues = parsed.error.issues.map(({ code, message, path }) => ({ code, message, path }));
        logger.log("warn", "agent_core.output_invalid", { attempt: attempt + 1, issueCount: Array.isArray(validationIssues) ? validationIssues.length : 0 });
      } catch (error) {
        consumedModelCalls += errorModelCalls(error);
        observedToolExecutions.push(...errorToolExecutions(error));
        throw providerFailure("Agent", error, combined, { providerError: error, toolExecutions: observedToolExecutions, modelCalls: consumedModelCalls, budget: budgetResult(consumedModelCalls, 0) });
      }
    }
    const recovered = recoverUserStringAction(raw, input);
    if (recovered !== undefined) {
      (this.options.logger ?? noopLogger).child({ agentId: input.run.agentId, eventId: input.run.eventId, runId: input.run.runId }).log("warn", "agent_core.string_action_recovered", { modelCalls: consumedModelCalls });
      return { ...(currentEventAssessment === undefined ? {} : { assessment: currentEventAssessment }), output: recovered, toolExecutions: observedToolExecutions, budget: budgetResult(consumedModelCalls, this.#maxRepairs) };
    }
    throw new DomainError(consumedModelCalls >= input.limits.maxSteps ? "LIMIT_EXCEEDED" : "VALIDATION", `Agent returned invalid structured output after ${String(consumedModelCalls)} model calls: ${JSON.stringify(validationIssues)}`, { cause: { toolExecutions: observedToolExecutions, budget: budgetResult(consumedModelCalls, Math.max(0, Math.min(this.#maxRepairs, consumedModelCalls - 1))) } });
  }
}

export type OllamaDeepAgentConfig = OllamaChatConfig & { readonly toolRegistry?: ToolRegistry; readonly logger?: Logger; readonly now?: () => Date; readonly agentFactory?: ReusableDeepAgentFactory; readonly modelFactory?: typeof createOllamaChatModel };

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
  const model = (config.modelFactory ?? createOllamaChatModel)(config);
  const logger = config.logger ?? noopLogger;
  const now = config.now ?? (() => new Date());
  const tools = config.toolRegistry === undefined ? [] : createDeepAgentTools(config.toolRegistry, now, logger);
  const assessmentToolName = "submit_event_assessment";
  const assessmentModel = model.bindTools([{ type: "function" as const, function: { name: assessmentToolName, description: "現在Eventの主観的Meaningと、そのEventに対するEmotionを返す", parameters: z.toJSONSchema(EventAssessmentSchema) } }]);
  const middleware = [createAgentCoreMiddleware(config.toolRegistry, logger, now)];
  const factory: ReusableDeepAgentFactory = config.agentFactory ?? ((options) => createDeepAgent({
    model: options.model,
    tools: options.tools,
    systemPrompt: options.systemPrompt,
    responseFormat: options.responseFormat,
    contextSchema: options.contextSchema,
    middleware: options.middleware as NonNullable<NonNullable<Parameters<typeof createDeepAgent>[0]>["middleware"]>
  }) as unknown as ReusableDeepAgent);
  const responseFormat = toolStrategy(AgentCoreModelOutputJsonSchema, { handleError: (error) => {
    logger.log("warn", "agent_core.structured_output_invalid", errorLogContext(error));
    return "構造化出力が不正です。通常Toolは使わず、指定Schemaの全フィールドを含む最終回答を構造化出力専用Toolでちょうど1件だけ返してください。検証エラー: " + error.message;
  } }) as unknown as AgentCoreResponseFormat;
  const agent = factory({ model, tools: tools as DeepAgentToolsOption, systemPrompt: completeAgentCoreSystemPrompt, responseFormat, contextSchema: DeepAgentToolRunContextSchema, middleware });
  return {
    async assess(input, options) {
      if (options.maxModelCalls < 1) throw new DomainError("LIMIT_EXCEEDED", "No model call budget remains for Event assessment");
      const messages = [new SystemMessage(`現在Eventの主観的Meaningと、そのEventに対するEmotionを先に確定します。最終Actionや通常Tool選択は行わず、${assessmentToolName}をちょうど1件呼び出してください。`), ...input.messages];
      const components = { messages: estimateTokens(messages), tools: 0, outputSchema: estimateTokens(z.toJSONSchema(EventAssessmentSchema)) };
      const estimatedTokens = Object.values(components).reduce((sum, value) => sum + value, 0);
      if (estimatedTokens > MAX_MODEL_INPUT_TOKENS) logger.log("warn", "event_assessment.model_input_budget_exceeded", { agentId: options.agentId, eventId: options.eventId, runId: options.runId, estimatedTokens, warningThreshold: MAX_MODEL_INPUT_TOKENS, budgetComponents: JSON.stringify(components) });
      try {
        const response = await assessmentModel.invoke(messages, { signal: options.signal });
        const calls = response.tool_calls ?? [];
        const submitted = calls.find(({ name }) => name === assessmentToolName);
        if (submitted === undefined || calls.length !== 1) throw new DomainError("VALIDATION", "Event assessment must call submit_event_assessment exactly once");
        return { assessment: EventAssessmentSchema.parse(submitted.args), modelCalls: 1 };
      }
      catch (error) { throw new DomainError("EXTERNAL", "Event assessment invocation failed", { cause: { providerError: error, modelCalls: 1 } }); }
    },
    async invoke(input, options) {
      const context = createDeepAgentToolRunContext({
        agentId: options.agentId,
        runId: options.runId,
        eventId: options.eventId,
        maxToolCalls: Math.min(25, options.maxToolCalls),
        signal: options.signal,
        ...(options.recentToolInputs === undefined ? {} : { recentToolInputs: options.recentToolInputs }),
        ...(options.transport === undefined ? {} : { transport: options.transport })
      });
      context.collector.explorationModelCalls = 1;
      try {
        const result = await agent.invoke({ messages: [...input.messages] }, { signal: options.signal, recursionLimit: options.recursionLimit, context });
        return { structuredResponse: domainOutputFromFlat(result.structuredResponse), messages: result.messages, toolExecutions: context.collector.executions, modelCalls: Math.max(1, context.collector.modelCallCount) };
      } catch (error) { throw new DomainError("EXTERNAL", "Deep Agent invocation failed", { cause: { providerError: error, toolExecutions: context.collector.executions, modelCalls: Math.max(1, context.collector.modelCallCount) } }); }
    }
  };
}
