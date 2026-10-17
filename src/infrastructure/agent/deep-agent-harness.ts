import { agentCoreSystemPrompt } from "./deep-agent-prompt.js";
import { autonomousExplorationPrompt } from "./autonomous-exploration-prompt.js";
import { concernLifecyclePrompt } from "./concern-lifecycle-prompt.js";
import { createAgentCoreMiddleware } from "./deep-agent-middleware.js";
import { createDeepAgentTools, createDeepAgentToolRunContext, DeepAgentToolRunContextSchema, type DeepAgentToolRunContext } from "./deep-agent-tools.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { createDeepAgent } from "deepagents";
import { toolStrategy, type TypedToolStrategy } from "langchain";
import { z } from "zod";

import type { AgentHarness } from "../../application/ports.js";
import { estimateTokens } from "../../application/context-builder.js";
import { projectToolResult, type ToolRegistry } from "../../application/tool-registry.js";
import { AgentCoreOutputSchema, ConcernProposalSchema, DomainError, EventAssessmentSchema, type AgentCoreInput, type AgentRunResult, type ConcernProposal, type EventAssessment, type ToolExecutionRecord } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";

type DeepAgentToolsOption = NonNullable<NonNullable<Parameters<typeof createDeepAgent>[0]>["tools"]>;

const AgentCoreFlatOutputSchema = z.object({
  meaning: z.string().trim().min(1).max(800).optional().describe("今回のEvent処理を終えた時点で、この経験が自分にとって何を意味するかを1〜2文で書く。感情、願望、計画、Actionは書かない"),
  feeling: z.string().trim().min(1).max(160).optional().describe("今回のEvent処理を終えた時点で残っている短期的な感情を、感情語中心の1文で書く。例: 嬉しい、期待、不安、落胆、苛立ち、安堵、退屈。例から選ぶ必要はない。Eventの説明、理由、願望、計画、Action、持続するMoodは書かない。特に残る感情がなければ省略する"),
  desire: z.string().trim().min(1).max(800).describe("今回のEventを受けて今具体的に望むこと。入力中の具体的な対象と状況に結び付けて短く書く"),
  actionType: z.enum(["respond", "refuse", "notify-no-execution", "no-external-action"]).describe("今回確定するAction。発話はrespond、拒否はrefuse、非実行判断の通知はnotify-no-execution、発話しない場合はno-external-actionを選ぶ"),
  content: z.string().trim().min(1).max(6_000).optional().describe("respond、refuse、notify-no-executionでユーザーへそのまま配送する本文。それらのActionでは必須。内部判断、管理情報、Schema、ID、Tool traceを含めず、通常会話は簡潔かつ具体的に書く"),
  reason: z.string().trim().min(1).max(800).optional().describe("refuse、notify-no-execution、no-external-actionの内部理由。それらのActionでは必須。ユーザーへ配送するcontentには混ぜない"),
  refusalBasis: z.enum(["personality", "system"]).optional().describe("refuseの根拠。refuseの場合だけ必須"),
  mood: z.string().trim().min(1).max(160).optional().describe("今回だけの反応ではなく、次の複数Eventにも影響する背景的な気分を短い1文で書く。例: 穏やかで好奇心が強い。現在のEvent、返答待ち、理由、願望、計画は書かない。持続する変化がない場合は省略する"),
  relationshipOperation: z.enum(["upsert", "remove"]).optional().describe("Relationshipを変更する場合の操作。変更しない場合は省略"),
  relationshipSubjectId: z.string().min(1).optional().describe("Relationshipの相手ID。relationshipOperation指定時は必須"),
  relationshipDescription: z.string().trim().min(1).max(800).optional().describe("現在の関係性。プロフィール事実ではなく、信頼、共有の仕方、会話の深まりなど関係自体を書く。relationshipOperationがupsertの場合は必須"),
  remember: z.string().trim().min(1).max(800).optional().describe("今回すぐ記憶候補に残す要点。ユーザーの生活、仕事、趣味、経験、好みなど次回以降に価値がある具体的事実も対象とする。会話やTool結果を転載せず1〜2文で指定")
}).strict().describe("Agent Coreの最終判断。必要なActionフィールドだけを埋め、状態変更がなければ状態フィールドを省略する");
export const completeAgentCoreSystemPrompt = `${agentCoreSystemPrompt}${autonomousExplorationPrompt}${concernLifecyclePrompt}`;
type AgentCoreResponseFormat = TypedToolStrategy<z.infer<typeof AgentCoreFlatOutputSchema>>;

export const AgentCoreModelOutputJsonSchema = modelJsonSchema(AgentCoreFlatOutputSchema);
export const agentCoreStructuredOutputRepairMessage = "最終出力がSchema不一致です。通常Tool、本文、Markdown、action objectは返さず、構造化出力専用Toolを1回だけ呼んでください。desireとactionTypeは必須です。meaningとfeelingはEvent終了時の評価がある場合だけ指定します。actionTypeがrespondならcontent、refuseならcontent・reason・refusalBasis、notify-no-executionならcontent・reason、no-external-actionならreasonを指定してください。状態変更がなければmood、relationship系、rememberは省略してください。";

function domainOutputFromFlat(value: unknown): unknown {
  const parsed = AgentCoreFlatOutputSchema.safeParse(value);
  if (!parsed.success) return value;
  const flat = parsed.data;
  const action = flat.actionType === "respond" ? { type: flat.actionType, content: flat.content }
    : flat.actionType === "refuse" ? { type: flat.actionType, content: flat.content, reason: flat.reason, basis: flat.refusalBasis }
      : flat.actionType === "notify-no-execution" ? { type: flat.actionType, content: flat.content, reason: flat.reason }
        : { type: flat.actionType, reason: flat.reason };
  const relationship = flat.relationshipOperation === "upsert"
    ? { operation: flat.relationshipOperation, relationship: { subjectId: flat.relationshipSubjectId, description: flat.relationshipDescription } }
    : flat.relationshipOperation === "remove" ? { operation: flat.relationshipOperation, subjectId: flat.relationshipSubjectId } : undefined;
  const hasPatch = flat.mood !== undefined || relationship !== undefined || flat.remember !== undefined;
  return { ...(flat.meaning === undefined ? {} : { meaning: flat.meaning }), ...(flat.feeling === undefined ? {} : { feeling: flat.feeling }), desire: flat.desire, action, ...(hasPatch ? { patch: { ...(flat.mood === undefined ? {} : { mood: flat.mood }), ...(relationship === undefined ? {} : { relationship }), ...(flat.remember === undefined ? {} : { remember: flat.remember }) } } : {}) };
}

const AgentCoreDecisionSchema = AgentCoreOutputSchema.extend({
  meaning: EventAssessmentSchema.shape.meaning,
  feeling: EventAssessmentSchema.shape.feeling
}).strict();

function decisionResult(value: z.infer<typeof AgentCoreDecisionSchema>): { readonly output: AgentRunResult["output"]; readonly assessment?: EventAssessment } {
  const { meaning, feeling, ...output } = value;
  const assessment = meaning === undefined && feeling === undefined ? undefined : EventAssessmentSchema.parse({ ...(meaning === undefined ? {} : { meaning }), ...(feeling === undefined ? {} : { feeling }) });
  return { output, ...(assessment === undefined ? {} : { assessment }) };
}

function concernProposals(executions: readonly ToolExecutionRecord[]): ConcernProposal[] {
  return executions.flatMap((execution) => {
    if (execution.name !== "concern_propose" || !execution.ok) return [];
    const value = typeof execution.result === "object" && execution.result !== null && "proposal" in execution.result ? execution.result.proposal : undefined;
    const parsed = ConcernProposalSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
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
export type DeepAgentInvokeOptions = { readonly signal: AbortSignal; readonly recursionLimit: number; readonly maxModelCalls: number; readonly agentId: string; readonly runId: string; readonly eventId: string; readonly eventKind?: AgentCoreInput["observation"]["kind"]; readonly maxToolCalls: number; readonly recentToolInputs?: readonly string[]; readonly transport?: AgentCoreInput["run"]["transport"] };
export interface DeepAgentInvoker {
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
    outputSchema: estimateTokens(AgentCoreModelOutputJsonSchema)
  };
  return { total: Object.values(components).reduce((sum, value) => sum + value, 0), components };
}

function errorToolExecutions(error: unknown): readonly ToolExecutionRecord[] {
  if (!(error instanceof Error) || typeof error.cause !== "object" || error.cause === null || !("toolExecutions" in error.cause) || !Array.isArray(error.cause.toolExecutions)) return [];
  return error.cause.toolExecutions as ToolExecutionRecord[];
}
function errorModelCalls(error: unknown): number {
  if (!(error instanceof Error) || typeof error.cause !== "object" || error.cause === null || !("modelCalls" in error.cause) || typeof error.cause.modelCalls !== "number") return 0;
  return error.cause.modelCalls;
}
function repairToolEvidence(executions: readonly ToolExecutionRecord[]): readonly unknown[] {
  return executions.slice(-8).map((execution) => ({
    tool: execution.name,
    ok: execution.ok,
    ...(execution.ok
      ? { result: projectToolResult(undefined, execution.result ?? null, "recent-experience") }
      : { error: execution.error ?? "Tool failed" })
  }));
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
    let raw: unknown; let validationIssues: unknown; const observedToolExecutions: ToolExecutionRecord[] = []; let consumedModelCalls = 0;
    const maxAttempts = this.#maxRepairs + 1;
    const budgetResult = (modelCalls: number, repairs: number) => ({ limits: { deadlineMs: input.limits.deadlineMs, maxSteps: input.limits.maxSteps, maxToolCalls: input.limits.maxToolCalls }, consumed: { modelCalls, toolCalls: observedToolExecutions.length, repairs } });
    for (let attempt = 0; attempt < maxAttempts && consumedModelCalls < input.limits.maxSteps; attempt += 1) {
      try {
        const logger = (this.options.logger ?? noopLogger).child({ agentId: input.run.agentId, eventId: input.run.eventId, runId: input.run.runId });
        logger.log("info", "agent_core.model_attempt_started", { attempt: attempt + 1, repair: attempt > 0 });
        const promptInput = {
          event: { kind: input.observation.kind, occurredAt: input.run.occurredAt, observation: input.observation },
          identity: input.currentSelf.identity,
          ...(input.persona === undefined ? {} : { persona: input.persona }),
          recentExperiences: input.recentExperiences.slice(-2),
          runtimeConstraints: input.runtimeConstraints,
          ...(input.previousAssessment === undefined ? {} : { previousAssessment: input.previousAssessment })
        };
        const content = attempt === 0
          ? JSON.stringify({ promptVersion: "agent-core-v3-ja", input: promptInput })
          : JSON.stringify({ instruction: "元の入力Contextと今回のTool結果を根拠に、直前の無効な出力をAgent Coreのフラット出力Schemaへ適合するよう修正してください。新しい調査や通常Tool呼び出しは行わず、構造化出力専用Toolを1件だけ呼び出してください。action objectは出力せず、actionTypeと、そのActionに必要なcontent、reason、refusalBasisだけをトップレベルへ出力してください。状態変更がなければ状態フィールドは省略してください。Contextを推測せず、与えられた内容だけを使ってください。", input: promptInput, toolEvidence: repairToolEvidence(observedToolExecutions), allowedEvidenceIds: [input.run.eventId, ...input.memories.map(({ id }) => id)], outputSchema: AgentCoreModelOutputJsonSchema, validationIssues, invalidOutput: raw });
        const modelBudget = modelInputBudget(input, content);
        if (modelBudget.total > MAX_MODEL_INPUT_TOKENS) logger.log("warn", "agent_core.model_input_budget_exceeded", { estimatedTokens: modelBudget.total, warningThreshold: MAX_MODEL_INPUT_TOKENS, budgetComponents: JSON.stringify(modelBudget.components) });
        const recentToolInputs = input.recentExperiences.flatMap(({ steps }) => steps.flatMap((step) => step.type === "tool" ? [JSON.stringify({ tool: step.name, input: step.input })] : []));
        const remainingModelCalls = input.limits.maxSteps - consumedModelCalls;
        const attemptToolCalls = attempt === 0 ? input.limits.maxToolCalls : 0;
        // LangGraph counts model and Tool nodes separately. Keep its safety limit
        // outside the business budgets so middleware can hide operational Tools
        // and spend one final node producing the structured response.
        const recursionLimit = remainingModelCalls + attemptToolCalls + 2;
        const result = await this.options.invoker.invoke({ messages: [{ role: "user", content }] }, { signal: combined, recursionLimit, maxModelCalls: remainingModelCalls, agentId: input.run.agentId, runId: input.run.runId, eventId: input.run.eventId, eventKind: input.observation.kind, maxToolCalls: attemptToolCalls, recentToolInputs, ...(input.run.transport === undefined ? {} : { transport: input.run.transport }) });
        const invokedModelCalls = result.modelCalls ?? 1;
        if (invokedModelCalls > remainingModelCalls) throw new DomainError("LIMIT_EXCEEDED", "Invoker exceeded the model call budget", { cause: { modelCalls: invokedModelCalls, toolExecutions: result.toolExecutions ?? [] } });
        consumedModelCalls += invokedModelCalls;
        observedToolExecutions.push(...(result.toolExecutions ?? []));
        raw = result.structuredResponse;
        const parsed = AgentCoreDecisionSchema.safeParse(raw);
        if (parsed.success) { logger.log("info", "agent_core.model_attempt_completed", { attempt: attempt + 1, modelCalls: consumedModelCalls, maxToolCalls: input.limits.maxToolCalls }); return { ...decisionResult(parsed.data), toolExecutions: observedToolExecutions, concernProposals: concernProposals(observedToolExecutions), budget: budgetResult(consumedModelCalls, attempt) }; }
        validationIssues = parsed.error.issues.map(({ code, message, path }) => ({ code, message, path }));
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
      return { output: recovered, toolExecutions: observedToolExecutions, concernProposals: concernProposals(observedToolExecutions), budget: budgetResult(consumedModelCalls, this.#maxRepairs) };
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
    return agentCoreStructuredOutputRepairMessage;
  } }) as unknown as AgentCoreResponseFormat;
  const agent = factory({ model, tools: tools as DeepAgentToolsOption, systemPrompt: completeAgentCoreSystemPrompt, responseFormat, contextSchema: DeepAgentToolRunContextSchema, middleware });
  return {
    async invoke(input, options) {
      const context = createDeepAgentToolRunContext({
        agentId: options.agentId,
        runId: options.runId,
        eventId: options.eventId,
        eventKind: options.eventKind,
        maxModelCalls: options.maxModelCalls,
        maxToolCalls: Math.min(25, options.maxToolCalls),
        signal: options.signal,
        ...(options.recentToolInputs === undefined ? {} : { recentToolInputs: options.recentToolInputs }),
        ...(options.transport === undefined ? {} : { transport: options.transport })
      });
      try {
        const result = await agent.invoke({ messages: [...input.messages] }, { signal: options.signal, recursionLimit: options.recursionLimit, context });
        return { structuredResponse: domainOutputFromFlat(result.structuredResponse), messages: result.messages, toolExecutions: context.collector.executions, modelCalls: Math.max(1, context.collector.modelCallCount) };
      } catch (error) { throw new DomainError("EXTERNAL", "Deep Agent invocation failed", { cause: { providerError: error, toolExecutions: context.collector.executions, modelCalls: Math.max(1, context.collector.modelCallCount) } }); }
    }
  };
}
