import { agentCoreSystemPrompt } from "./deep-agent-prompt.js";
import { createAgentCoreMiddleware } from "./deep-agent-middleware.js";
import { createDeepAgentTools, createDeepAgentToolRunContext, DeepAgentToolRunContextSchema, type DeepAgentToolRunContext } from "./deep-agent-tools.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { toModelRecordView } from "./model-record-view.js";
import { createDeepAgent, FilesystemBackend } from "deepagents";
import { resolve } from "node:path";
import { toolStrategy, type TypedToolStrategy } from "langchain";
import { z } from "zod";

import type { AgentHarness } from "../../application/ports.js";
import { estimateTokens } from "../../application/context-builder.js";
import { projectToolResult, type ToolRegistry } from "../../application/tool-registry.js";
import { AgentCoreOutputSchema, DomainError, EventAssessmentSchema, ResolvedConcernProposalSchema, type AgentCoreInput, type AgentRunResult, type EventAssessment, type ResolvedConcernProposal, type ToolExecutionRecord } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";

type DeepAgentToolsOption = NonNullable<NonNullable<Parameters<typeof createDeepAgent>[0]>["tools"]>;

const AgentCoreFlatOutputSchema = z.object({
  meaning: z.string().trim().min(1).max(800).optional().describe("今回のEvent処理を終えた時点で、この経験が自分にとって何を意味するかを1〜2文で書く。感情、願望、計画、Actionは書かない"),
  feeling: z.string().trim().min(1).max(160).optional().describe("今回のEvent処理を終えた時点で残っている短期的な感情を、感情語中心の1文で書く。例: 喜び、期待、不安、落胆、苛立ち、怒り、驚き、警戒、安堵、退屈。例から選ぶ必要はない。Toolの失敗・探索結果・予測誤差への反応も書ける。Eventの説明、理由、願望、計画、Action、持続するMoodは書かない。特に残る感情がなければ省略する"),
  desire: z.string().trim().min(1).max(800).describe("今回のEventを受けて今具体的に望むこと。現在のコミットメントとして、入力中の具体的な対象と今回の行為に結び付けて短く書く。peer/directでは今回の会話目的（問い、反論、共有、依頼、約束、遊び又は協力）と、その目的が残るか満たされたかを表す。peer/observedでは、発話するなら具体的な未解決の問い、判断を変える差分、Concern又は約束の次行為、又は今言いたい自発表現を表す。長期的な協力関係、礼儀的な採用・感謝・同意だけを目的にしない。自律Eventでは、その対象が今のSelf、Concern、会話Memory、Background Experience、Mood、探索結果のどれと結び付くかも含める。既存Concernの言い換えにしない"),
  actionType: z.enum(["respond", "refuse", "notify-no-execution", "no-external-action"]).describe("今回確定するAction。発話はrespond、拒否はrefuse、非実行判断の通知はnotify-no-execution、発話しない時はno-external-actionを選ぶ。peer/directではreplyだけを理由に応答せず、会話目的が満たされた時に新しい問い・事実・反論・依頼又は自分の動機がなければno-external-actionを選ぶ。peer/observedではGateのengageを発話義務にせず、具体的な未解決の問い、実質的な反論・訂正・新事実、Concern又は約束の次行為を変える差分、自発的な遊び・感情・表現がなければno-external-actionを選ぶ。長期的な協力関係、礼儀、採用、感謝、同意だけでrespondしない。idleではrespondまたはrefuseを必ず選び、no-external-actionを選ばない。concern-formationは関心地図を形成する内部Eventなのでno-external-actionを選ぶ。情報が不十分ならidleではrespondで不十分な旨を伝える"),
  content: z.string().trim().min(1).max(6_000).optional().describe("respond、refuse、notify-no-executionで配送する唯一の本文。それらのActionでは必須。内部判断、管理情報、Schema、ID、Tool traceを含めず、通常会話は簡潔かつ具体的に書く"),
  recipient: z.enum(["user", "channel"]).optional().describe("respondの配送先。省略時はEventの発話元へreplyし、userはowner user、channelは非mention通常投稿。Bot名やDiscord情報を指定してBotへmentionしない"),
  reason: z.string().trim().min(1).max(800).optional().describe("refuse、notify-no-execution、no-external-actionの内部理由。それらのActionでは必須。peer/direct又はpeer/observedのno-external-actionでは、会話目的が満たされたこと、又は具体的な問い・差分・次行為・自発表現がないことを書く。ユーザーへ配送するcontentには混ぜない"),
  refusalBasis: z.enum(["personality", "system"]).optional().describe("refuseの根拠。refuseの場合だけ必須")
}).strict().describe("Agent Coreの最終判断。今回のMeaning・Feeling・Desire・Actionだけを埋める。Memory、Relationship、Moodの持続的な保存判断はExperience Integrationへ渡す");
export const completeAgentCoreSystemPrompt = agentCoreSystemPrompt;

function dispositionTendency(disposition: string): string {
  const sentences = disposition.split(/(?<=[。！？])/u).map((value) => value.trim()).filter((value) => value.length > 0);
  const selected = [sentences[0], ...sentences.filter((value) => /対話相手|相手|人と話/u.test(value))].filter((value, index, values): value is string => value !== undefined && values.indexOf(value) === index);
  return selected.join(" ").slice(0, 400);
}
type AgentCoreResponseFormat = TypedToolStrategy<z.infer<typeof AgentCoreFlatOutputSchema>>;

export const AgentCoreModelOutputJsonSchema = modelJsonSchema(AgentCoreFlatOutputSchema);
export const agentCoreStructuredOutputRepairMessage = "最終出力がSchema不一致です。通常Tool、本文、Markdown、action objectは返さず、構造化出力専用Toolを1回だけ呼んでください。desireとactionTypeは必須です。actionTypeがrespondなら唯一の本文をcontentへ書き、配送先は必要な場合だけrecipientへuser又はchannelで書いてください。省略時はEvent発話元へのreplyです。Bot名をrecipientへ書かず、同時に複数配送しません。meaningとfeelingはEvent終了時の評価がある場合だけ指定します。refuseならcontent・reason・refusalBasis、notify-no-executionならcontent・reasonを指定してください。Memory、Relationship、Moodは出力しません。";

function domainOutputFromFlat(value: unknown): unknown {
  const parsed = AgentCoreFlatOutputSchema.safeParse(value);
  if (!parsed.success) return value;
  const flat = parsed.data;
  const action = flat.actionType === "respond" ? { type: flat.actionType, content: flat.content, ...(flat.recipient === undefined ? {} : { recipient: flat.recipient }) }
    : flat.actionType === "refuse" ? { type: flat.actionType, content: flat.content, reason: flat.reason, basis: flat.refusalBasis }
      : flat.actionType === "notify-no-execution" ? { type: flat.actionType, content: flat.content, reason: flat.reason }
        : { type: flat.actionType, reason: flat.reason };
  return { ...(flat.meaning === undefined ? {} : { meaning: flat.meaning }), ...(flat.feeling === undefined ? {} : { feeling: flat.feeling }), desire: flat.desire, action };
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

function concernProposals(executions: readonly ToolExecutionRecord[]): ResolvedConcernProposal[] {
  return executions.flatMap((execution) => {
    if (execution.name !== "concern_propose" || !execution.ok) return [];
    const value = typeof execution.result === "object" && execution.result !== null && "proposal" in execution.result ? execution.result.proposal : undefined;
    const parsed = ResolvedConcernProposalSchema.safeParse(value);
    return parsed.success ? [parsed.data] : [];
  });
}

type ReusableDeepAgent = {
  invoke(
    input: { readonly messages: readonly { readonly role: "user"; readonly content: string }[] },
    options: { readonly signal: AbortSignal; readonly recursionLimit: number; readonly context: DeepAgentToolRunContext }
  ): Promise<{ readonly structuredResponse?: unknown; readonly messages?: unknown }>;
};

export type ReusableDeepAgentFactoryOptions = {
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
export type DeepAgentInvokeOptions = { readonly signal: AbortSignal; readonly recursionLimit: number; readonly maxModelCalls: number; readonly maxExplorationModelCalls?: number; readonly agentId: string; readonly runId: string; readonly eventId: string; readonly eventKind?: AgentCoreInput["observation"]["kind"]; readonly eventTargetKind?: string | undefined; readonly concernDueSignalClaimedAt?: string | undefined; readonly maxToolCalls: number; readonly transport?: AgentCoreInput["run"]["transport"] };
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
function hasGraphRecursionError(value: unknown, seen = new Set<object>()): boolean {
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  seen.add(value);
  if (value instanceof Error && (value.name === "GraphRecursionError" || /Recursion limit of \d+ reached/u.test(value.message))) return true;
  const record = value as Record<string, unknown>;
  return hasGraphRecursionError(record.cause, seen) || hasGraphRecursionError(record.providerError, seen);
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
/** All Agent Core model-facing values use a natural-language view. Runtime
 * identifiers remain in the collector and persistence layers only. */
export const agentCoreModelView = toModelRecordView;
const USER_RESPONSE_FALLBACK = "申し訳ありません。応答の形式を処理できませんでした。もう一度お試しください。";
function recoverUserStringAction(raw: unknown, input: AgentCoreInput): AgentRunResult["output"] | undefined {
  if ((input.observation.kind !== "message-received" && input.observation.kind !== "user-message") || typeof raw !== "object" || raw === null || !("action" in raw) || typeof raw.action !== "string") return undefined;
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

function isIdleEvent(input: AgentCoreInput): boolean {
  const content = input.observation.content;
  return input.observation.kind === "internal" && typeof content === "object" && content !== null && "targetKind" in content && content.targetKind === "idle";
}

function eventTargetKind(input: AgentCoreInput): string | undefined {
  const content = input.observation.content;
  return typeof content === "object" && content !== null && "targetKind" in content && typeof content.targetKind === "string" ? content.targetKind : undefined;
}

function concernDueSignalClaimedAt(input: AgentCoreInput): string | undefined {
  const content = input.observation.content;
  return eventTargetKind(input) === "concern-due" && typeof content === "object" && content !== null && "signalClaimedAt" in content && typeof content.signalClaimedAt === "string" ? content.signalClaimedAt : undefined;
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
    const logger = (this.options.logger ?? noopLogger).child({ agentId: input.run.agentId, eventId: input.run.eventId, runId: input.run.runId });
    const promptInput = agentCoreModelView({
      event: { kind: input.observation.kind, occurredAt: input.run.occurredAt, observation: input.observation },
      identity: input.currentSelf.identity,
      dispositionTendency: dispositionTendency(input.currentSelf.disposition),
      ...(input.persona === undefined ? {} : { persona: input.persona }),
      recentExperiences: input.recentExperiences.slice(-2),
      runtimeConstraints: input.runtimeConstraints,
      ...(input.previousAssessment === undefined ? {} : { previousAssessment: input.previousAssessment }),
      ...(input.previousDesire === undefined ? {} : { previousDesire: input.previousDesire }),
      ...(input.predictionContext === undefined ? {} : { predictionContext: input.predictionContext })
    });
    attempts: for (let attempt = 0; attempt < maxAttempts && consumedModelCalls < input.limits.maxSteps; attempt += 1) {
      try {
        logger.log("info", "agent_core.model_attempt_started", { attempt: attempt + 1, repair: attempt > 0 });
        const content = attempt === 0
          ? JSON.stringify({ promptVersion: "agent-core-v3-ja", input: promptInput })
          : JSON.stringify({ instruction: "元の入力Contextと今回のTool結果を根拠に、直前の無効な出力をAgent Coreのフラット出力Schemaへ適合するよう修正してください。新しい調査や通常Tool呼び出しは行わず、構造化出力専用Toolを1件だけ呼び出してください。action objectは出力せず、actionTypeと、そのActionに必要なcontent、reason、refusalBasisだけをトップレベルへ出力してください。Memory、Relationship、Moodは出力しません。Contextを推測せず、与えられた内容だけを使ってください。", input: promptInput, toolEvidence: repairToolEvidence(observedToolExecutions), outputSchema: AgentCoreModelOutputJsonSchema, validationIssues, invalidOutput: agentCoreModelView(raw) });
        const modelBudget = modelInputBudget(input, content);
        logger.log("info", "agent_core.model_input_budget", { estimatedTokens: modelBudget.total, budgetComponents: JSON.stringify(modelBudget.components) });
        if (modelBudget.total > MAX_MODEL_INPUT_TOKENS) logger.log("warn", "agent_core.model_input_budget_exceeded", { estimatedTokens: modelBudget.total, warningThreshold: MAX_MODEL_INPUT_TOKENS, budgetComponents: JSON.stringify(modelBudget.components) });
        const remainingModelCalls = input.limits.maxSteps - consumedModelCalls;
        const attemptToolCalls = attempt === 0 ? input.limits.maxToolCalls : 0;
        // A structured-output attempt may need one call to switch out of Tool use
        // and one repair call. Keep these two calls inside the total model budget.
        const finalizationReserveModelCalls = Math.min(2, remainingModelCalls);
        const exploratoryModelCalls = remainingModelCalls - finalizationReserveModelCalls;
        const recursionLimit = remainingModelCalls * 2 + attemptToolCalls + 6;
        const result = await this.options.invoker.invoke({ messages: [{ role: "user", content }] }, { signal: combined, recursionLimit, maxModelCalls: remainingModelCalls, maxExplorationModelCalls: exploratoryModelCalls, agentId: input.run.agentId, runId: input.run.runId, eventId: input.run.eventId, eventKind: input.observation.kind, ...(eventTargetKind(input) === undefined ? {} : { eventTargetKind: eventTargetKind(input) }), ...(concernDueSignalClaimedAt(input) === undefined ? {} : { concernDueSignalClaimedAt: concernDueSignalClaimedAt(input) }), maxToolCalls: attemptToolCalls, ...(input.run.transport === undefined ? {} : { transport: input.run.transport }) });
        const invokedModelCalls = result.modelCalls ?? 1;
        if (invokedModelCalls > remainingModelCalls) throw new DomainError("LIMIT_EXCEEDED", "Invoker exceeded the total model call budget", { cause: { modelCalls: invokedModelCalls, toolExecutions: result.toolExecutions ?? [] } });
        consumedModelCalls += invokedModelCalls;
        observedToolExecutions.push(...(result.toolExecutions ?? []));
        raw = result.structuredResponse;
        const parsed = AgentCoreDecisionSchema.safeParse(raw);
        if (parsed.success) {
          const decision = decisionResult(parsed.data);
          if (isIdleEvent(input) && decision.output.action.type === "no-external-action") {
            validationIssues = [{ code: "custom", message: "idle Eventではno-external-actionを選べません。不十分ならrespondでその旨を伝えてください", path: ["actionType"] }];
            logger.log("warn", "agent_core.idle_silence_rejected", { attempt: attempt + 1 });
            continue;
          }
          logger.log("info", "agent_core.model_attempt_completed", { attempt: attempt + 1, modelCalls: consumedModelCalls, maxToolCalls: input.limits.maxToolCalls });
          return { ...decision, toolExecutions: observedToolExecutions, concernProposals: concernProposals(observedToolExecutions), budget: budgetResult(consumedModelCalls, attempt) };
        }
        validationIssues = parsed.error.issues.map(({ code, message, path }) => ({ code, message, path }));
        logger.log("warn", "agent_core.output_invalid", { attempt: attempt + 1, issueCount: Array.isArray(validationIssues) ? validationIssues.length : 0 });
      } catch (error) {
        consumedModelCalls += errorModelCalls(error);
        observedToolExecutions.push(...errorToolExecutions(error));
        const remainingModelCalls = input.limits.maxSteps - consumedModelCalls;
        if (hasGraphRecursionError(error) && !combined.aborted && remainingModelCalls > 0) {
          logger.log("warn", "agent_core.graph_recursion_recovery_started", { modelCalls: consumedModelCalls, toolCalls: observedToolExecutions.length, remainingModelCalls });
          const recoveryContent = JSON.stringify({
            instruction: "通常の探索は上限で停止しました。以下の入力と、ここまでに得たTool結果だけを根拠に、追加の通常Toolを呼び出さず、構造化出力専用Toolを1回だけ呼んで最終Actionを返してください。情報が足りない場合は推測せず、respondでその旨を伝えるか、適切ならrefuseを選んでください。",
            input: promptInput,
            toolEvidence: repairToolEvidence(observedToolExecutions),
            outputSchema: AgentCoreModelOutputJsonSchema
          });
          try {
            const recovery = await this.options.invoker.invoke({ messages: [{ role: "user", content: recoveryContent }] }, { signal: combined, recursionLimit: 8, maxModelCalls: 1, maxExplorationModelCalls: 0, agentId: input.run.agentId, runId: input.run.runId, eventId: input.run.eventId, eventKind: input.observation.kind, ...(eventTargetKind(input) === undefined ? {} : { eventTargetKind: eventTargetKind(input) }), ...(concernDueSignalClaimedAt(input) === undefined ? {} : { concernDueSignalClaimedAt: concernDueSignalClaimedAt(input) }), maxToolCalls: 0, ...(input.run.transport === undefined ? {} : { transport: input.run.transport }) });
            const recoveryModelCalls = recovery.modelCalls ?? 1;
            if (recoveryModelCalls > remainingModelCalls) throw new DomainError("LIMIT_EXCEEDED", "Recovery invoker exceeded the reserved final model call", { cause: { modelCalls: recoveryModelCalls, toolExecutions: recovery.toolExecutions ?? [] } });
            consumedModelCalls += recoveryModelCalls;
            observedToolExecutions.push(...(recovery.toolExecutions ?? []));
            raw = recovery.structuredResponse;
            const parsed = AgentCoreDecisionSchema.safeParse(raw);
            if (parsed.success) {
              const decision = decisionResult(parsed.data);
              if (!(isIdleEvent(input) && decision.output.action.type === "no-external-action")) {
                logger.log("info", "agent_core.graph_recursion_recovery_completed", { modelCalls: consumedModelCalls, toolCalls: observedToolExecutions.length });
                return { ...decision, toolExecutions: observedToolExecutions, concernProposals: concernProposals(observedToolExecutions), budget: budgetResult(consumedModelCalls, attempt + 1) };
              }
              validationIssues = [{ code: "custom", message: "idle Eventではno-external-actionを選べません", path: ["actionType"] }];
            } else validationIssues = parsed.error.issues.map(({ code, message, path }) => ({ code, message, path }));
            logger.log("warn", "agent_core.graph_recursion_recovery_invalid", { issueCount: Array.isArray(validationIssues) ? validationIssues.length : 0 });
            break attempts;
          } catch (recoveryError) {
            consumedModelCalls += errorModelCalls(recoveryError);
            observedToolExecutions.push(...errorToolExecutions(recoveryError));
            throw providerFailure("Agent", recoveryError, combined, { providerError: recoveryError, priorProviderError: error, toolExecutions: observedToolExecutions, modelCalls: consumedModelCalls, budget: budgetResult(consumedModelCalls, attempt + 1) });
          }
        }
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

export type OllamaDeepAgentConfig = OllamaChatConfig & { readonly toolRegistry?: ToolRegistry; readonly logger?: Logger; readonly now?: () => Date; readonly agentFactory?: ReusableDeepAgentFactory; readonly modelFactory?: typeof createOllamaChatModel; readonly skillsRoot?: string };

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

export function createDefaultDeepAgentFactory(skillsRoot: string, deepAgent: typeof createDeepAgent = createDeepAgent): ReusableDeepAgentFactory {
  return (options) => {
    const backend = new FilesystemBackend({ rootDir: skillsRoot, virtualMode: true });
    return deepAgent({
      model: options.model,
      tools: options.tools,
      systemPrompt: options.systemPrompt,
      responseFormat: options.responseFormat,
      contextSchema: options.contextSchema,
      middleware: options.middleware as NonNullable<NonNullable<Parameters<typeof createDeepAgent>[0]>["middleware"]>,
      backend,
      skills: ["/"]
    }) as unknown as ReusableDeepAgent;
  };
}

export function createOllamaDeepAgentInvoker(config: OllamaDeepAgentConfig): DeepAgentInvoker {
  const model = (config.modelFactory ?? createOllamaChatModel)({ ...config, think: "high" });
  const logger = config.logger ?? noopLogger;
  const now = config.now ?? (() => new Date());
  const tools = config.toolRegistry === undefined ? [] : createDeepAgentTools(config.toolRegistry, now, logger, toModelRecordView);
  const middleware = [createAgentCoreMiddleware(config.toolRegistry, logger, now)];
  const factory: ReusableDeepAgentFactory = config.agentFactory ?? createDefaultDeepAgentFactory(config.skillsRoot ?? resolve(process.cwd(), "skills"));
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
        eventTargetKind: options.eventTargetKind,
        ...(options.concernDueSignalClaimedAt === undefined ? {} : { concernDueSignalClaimedAt: options.concernDueSignalClaimedAt }),
        maxModelCalls: options.maxModelCalls,
        ...(options.maxExplorationModelCalls === undefined ? {} : { maxExplorationModelCalls: options.maxExplorationModelCalls }),
        maxToolCalls: Math.min(25, options.maxToolCalls),
        signal: options.signal,
        ...(options.transport === undefined ? {} : { transport: options.transport })
      });
      try {
        const result = await agent.invoke({ messages: [...input.messages] }, { signal: options.signal, recursionLimit: options.recursionLimit, context });
        return { structuredResponse: domainOutputFromFlat(result.structuredResponse), messages: result.messages, toolExecutions: context.collector.executions, modelCalls: Math.max(1, context.collector.modelCallCount) };
      } catch (error) { throw new DomainError("EXTERNAL", "Deep Agent invocation failed", { cause: { providerError: error, toolExecutions: context.collector.executions, modelCalls: Math.max(1, context.collector.modelCallCount) } }); }
    }
  };
}
