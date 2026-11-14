import { createDeepAgent } from "deepagents";
import { toolStrategy, type TypedToolStrategy } from "langchain";
import { z } from "zod";

import { estimateTokens } from "../../application/context-builder.js";
import { reflectionConcernContext } from "../../application/reflection-concern-context.js";
import { ConcernReflectorOutputSchema, MemoryReconciliationOutputSchema, MemoryReflectorOutputSchema, ReflectionInputSchema, ReflectionOutputSchema, RelationshipReflectorOutputSchema, SelfMoodReflectorOutputSchema, type ReflectionInput, type ReflectionModel, type ReflectionOutput, type ReflectionTarget, type TargetedReflectionModel, type ReflectorResult } from "../../application/reflection.js";
import { DomainError } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { ToolRegistry } from "../../application/tool-registry.js";
import { createDeepAgentTools, createDeepAgentToolRunContext, DeepAgentToolRunContextSchema } from "./deep-agent-tools.js";
import { concernLifecyclePrompt } from "./concern-lifecycle-prompt.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";

const ReflectionMemorySchema = z.object({
  summary: z.string().trim().min(1).max(800).describe("後の判断や検索で再利用する経験の要点。会話やTool結果を転載せず、何が起き、どうなったかを具体的に1〜2文で書く"),
  significance: z.string().trim().min(1).max(400).describe("この経験を今後も覚える具体的理由。説明を繰り返さず、Self、Concern、関係、判断のどれに影響するかを1文で書く"),
  subjects: z.array(z.string().min(1)).max(12).describe("このMemoryを人物・対象から検索するためのID。入力にあるIDだけを使い、対象がなければ空配列"),
  occurredAt: z.iso.datetime({ offset: true }).describe("Memoryの時系列順と根拠追跡に使うISO 8601日時。根拠EventのoccurredAtをそのまま使う"),
  source: z.string().trim().min(1).max(16_000).optional().describe("伝聞と直接経験を区別する情報源ID。入力に情報源が明記された伝聞だけに指定する")
}).strict().describe("今後の判断に再利用する価値がある経験。入力Eventの単なる要約は保存しない");

const ReflectionConcernChangeSchema = z.object({
  operation: z.enum(["create", "upsert", "remove"]).describe("新しいConcernを作るならcreate、既存Concernを更新するならupsert、重複や不要な既存Concernを消すならremove"),
  id: z.string().min(1).optional().describe("入力state.concernsに存在するConcern ID。upsertとremoveでは必須。createでは指定しない"),
  description: z.string().trim().min(1).max(800).optional().describe("気に掛けること。未解決課題だけでなく、知りたい、確かめたい、共有したい、守りたいことを800文字以内の一文で書く。createとupsertで必須"),
  whyItMatters: z.string().trim().min(1).max(800).optional().describe("このConcernを次回以降の判断へ残す理由。現在のSelfや関係との結び付きを800文字以内で具体的に書く。createとupsertで必須"),
  status: z.enum(["active", "satisfied", "abandoned"]).optional().describe("activeは継続、satisfiedは満足して完了、abandonedは取り下げ。createではactiveだけ、upsertでは必須"),
  reconsiderAt: z.iso.datetime({ offset: true }).optional().describe("Schedulerが再検討Eventを起こすISO 8601日時。入力から明確な将来時刻を決められる場合だけ指定する")
}).strict().superRefine((value, context) => {
  if (value.operation === "create") {
    if (value.id !== undefined) context.addIssue({ code: "custom", path: ["id"], message: "create must not specify id" });
    if (value.description === undefined) context.addIssue({ code: "custom", path: ["description"], message: "create requires description" });
    if (value.whyItMatters === undefined) context.addIssue({ code: "custom", path: ["whyItMatters"], message: "create requires whyItMatters" });
    if (value.status !== undefined && value.status !== "active") context.addIssue({ code: "custom", path: ["status"], message: "create requires active status" });
    return;
  }
  if (value.id === undefined) context.addIssue({ code: "custom", path: ["id"], message: "upsert and remove require id" });
  if (value.operation === "upsert") {
    if (value.description === undefined) context.addIssue({ code: "custom", path: ["description"], message: "upsert requires description" });
    if (value.whyItMatters === undefined) context.addIssue({ code: "custom", path: ["whyItMatters"], message: "upsert requires whyItMatters" });
    if (value.status === undefined) context.addIssue({ code: "custom", path: ["status"], message: "upsert requires status" });
  }
}).describe("複数Eventにわたり判断へ影響するConcernの変更。今回だけの感想や実行手順は入れない");

const ReflectionRelationshipChangeSchema = z.object({
  operation: z.enum(["upsert", "remove"]).describe("今後の対人Contextへ残すならupsert、既存Relationshipを消すならremove"),
  subjectId: z.string().min(1).describe("関係する相手を識別する入力中のID"),
  description: z.string().trim().min(1).max(16_000).optional().describe("今後その相手への意味づけや応答へ影響する現在の関係。今回の会話内容ではなく、関係の変化を一文で書く。upsertだけに指定する")
}).strict().describe("特定の相手との持続的な関係の変更。関係が変わっていなければ出力しない");

export const ReflectionModelOutputSchema = z.object({
  memories: z.array(ReflectionMemorySchema).max(4).describe("Memory DBへ新規保存し、今後のContext検索に使う経験。保存価値がなければ空配列"),
  concernChanges: z.array(ReflectionConcernChangeSchema).max(4).describe("現在Stateのconcernsへ適用する変更。新規作成は最大3件。気に掛けていることが変わらなければ空配列"),
  relationshipChanges: z.array(ReflectionRelationshipChangeSchema).max(4).describe("現在Stateのrelationshipsへ適用する変更。関係が変わらなければ空配列"),
  mood: z.string().trim().min(1).max(160).optional().describe("今回だけのFeelingではなく、次の複数Eventの意味づけや行動へ影響する背景的な気分を短い1文で書く。例: 穏やかで好奇心が強い。現在のEvent、返答待ち、理由、願望、計画は書かない。持続する変化がなければ省略する"),
  selfIdentity: z.string().trim().min(1).max(16_000).optional().describe("全Eventで使う『自分は誰か』の現在表現。十分なMemory根拠で変化した場合だけ、完全な新しい値を指定する"),
  selfDisposition: z.string().trim().min(1).max(16_000).optional().describe("全Eventで使う、価値を感じやすい対象と意味づけの傾向。十分なMemory根拠で変化した場合だけ、完全な新しい値を指定する"),
  selfStory: z.string().trim().min(1).max(16_000).optional().describe("全Eventで使う、経験から形成された現在の自己理解。十分なMemory根拠で変化した場合だけ、完全な新しい値を指定する"),
  selfCommitments: z.array(z.string().trim().min(1).max(16_000)).max(12).optional().describe("全Eventで守るもの、続ける関係、譲らないこと。十分なMemory根拠で変化した場合だけ、完全な配列を指定する"),
  selfChangeReason: z.string().trim().min(1).max(16_000).optional().describe("どの反復経験または強い経験によりSelfがどう変わったか。Selfの全fieldと一緒にだけ指定する"),
  evidenceMemoryIds: z.array(z.string().min(1)).max(16).describe("Self変更または新規ConcernをRuntimeが検証するための根拠Memory ID。どちらも変更しない場合は空配列")
}).strict().superRefine((value, context) => {
  if (value.concernChanges.filter((change) => change.operation === "create").length > 3) context.addIssue({ code: "custom", path: ["concernChanges"], message: "create at most three Concerns per reflection" });
  if (value.concernChanges.some((change) => change.operation === "create") && value.evidenceMemoryIds.length === 0) context.addIssue({ code: "custom", path: ["evidenceMemoryIds"], message: "new Concerns require Memory evidence" });
  const selfFields = [value.selfIdentity, value.selfDisposition, value.selfStory, value.selfCommitments];
  const hasSelf = selfFields.some((field) => field !== undefined);
  const hasCompleteSelf = selfFields.every((field) => field !== undefined);
  if (hasSelf && !hasCompleteSelf) context.addIssue({ code: "custom", path: ["selfIdentity"], message: "Self changes require all Self fields together" });
  if (hasSelf && value.selfChangeReason === undefined) context.addIssue({ code: "custom", path: ["selfChangeReason"], message: "Self changes require an explicit reason" });
  if (!hasSelf && value.selfChangeReason !== undefined) context.addIssue({ code: "custom", path: ["selfChangeReason"], message: "selfChangeReason requires all Self fields" });
  if (hasSelf && value.evidenceMemoryIds.length === 0) context.addIssue({ code: "custom", path: ["evidenceMemoryIds"], message: "Self changes require Memory evidence" });
}).describe("永続状態へ実際に適用する最小限の変更。入力の説明や変更のない値は出力しない");

export const ReflectionModelOutputJsonSchema = modelJsonSchema(ReflectionModelOutputSchema);
export const reflectionStructuredOutputRepairMessage = "最終出力がSchema不一致です。本文、Markdown、Action、入力metadataは返さず、構造化出力専用Toolを1回だけ呼んでください。memories、concernChanges、relationshipChanges、evidenceMemoryIdsは必須の配列で、変更がなければ空配列にしてください。任意fieldは変更がある場合だけ指定してください。";
type ReflectionResponseFormat = TypedToolStrategy<z.infer<typeof ReflectionModelOutputSchema>>;

export const reflectionSystemPrompt = `あなたはAgentの経験を、次回以降の判断に必要な永続状態へ整理するReflection担当です。

目的:
- Eventの再説明ではなく、今後も使うMemory、気に掛けるConcern、関係の変化、持続するMoodだけを残す
- Selfは、反復した経験、強い経験、または既存Selfとの明確な矛盾があるときだけ更新する

出力基準:
- Memory: 何が起き、どうなり、なぜ今後の判断に重要かを具体的に書く
- Concern: 入力にあるConcernの重複整理、統合、具体化、終了判定に加え、Memory根拠とwhyItMattersがある新しいConcernを1回1〜3件まで作成できる。Agentが複数の異なる対象・動機を並行して気に掛けることは自然な通常状態であり、Concernが空、少ない、または一つの対象に偏っているなら、記録された経験から今後も残る関心を積極的にcreateする。件数だけで機械的に作らず、未返信や件数を理由に終了しない。createではidを指定しない
- Relationship: 特定の相手との関係が実際に変化した場合だけ書く
- Mood: 今回だけのFeelingではなく、次の複数Eventへ残る背景的な気分を短い1文で書く。現在のEvent、返答待ち、理由、願望、計画は含めず、持続する変化がなければ省略する
- Self: 全EventのContextを変える長期変化。変更する場合は全field、理由、入力Memory IDを揃える

制約:
- 入力にない事実、ID、日時、関係を作らない
- 新しいConcernには、入力Memory IDをevidenceMemoryIdsへ含める。入力Eventを網羅的に要約しない。同じ内容のMemoryを重複して作らない
- 変更がなければ配列は空、任意fieldは省略する。空のmaintenance結果は正しい
- reflectionId、agentId、expectedVersion、入力Selfを出力へ複製しない
- Action、ユーザー向け応答、Markdown、説明文は返さず、指定された構造化出力だけを返す${concernLifecyclePrompt}`;

function domainOutputFromModel(raw: unknown): unknown {
  const parsed = ReflectionModelOutputSchema.safeParse(raw);
  if (!parsed.success) return raw;
  const value = parsed.data;
  const concernChanges = value.concernChanges.map((change) => {
    if (change.operation === "remove") return { operation: change.operation, id: change.id };
    if (change.operation === "create") return { operation: change.operation, concern: { description: change.description, whyItMatters: change.whyItMatters, status: "active" as const, ...(change.reconsiderAt === undefined ? {} : { reconsiderAt: change.reconsiderAt }) } };
    return { operation: change.operation, concern: { id: change.id, description: change.description, whyItMatters: change.whyItMatters, status: change.status, ...(change.reconsiderAt === undefined ? {} : { reconsiderAt: change.reconsiderAt }) } };
  });
  const relationshipChanges = value.relationshipChanges.map((change) => change.operation === "remove"
    ? { operation: change.operation, subjectId: change.subjectId }
    : { operation: change.operation, relationship: { subjectId: change.subjectId, description: change.description } });
  const selfFields = [value.selfIdentity, value.selfDisposition, value.selfStory, value.selfCommitments];
  const hasSelf = selfFields.some((field) => field !== undefined);
  return {
    memories: value.memories,
    concernChanges,
    relationshipChanges,
    ...(value.mood === undefined ? {} : { mood: value.mood }),
    ...(hasSelf ? { self: { identity: value.selfIdentity, disposition: value.selfDisposition, selfStory: value.selfStory, commitments: value.selfCommitments } } : {}),
    ...(value.selfChangeReason === undefined ? {} : { selfChangeReason: value.selfChangeReason }),
    evidenceMemoryIds: value.evidenceMemoryIds
  };
}

export interface ReflectionInvoker {
  invoke(messages: readonly { readonly role: "user"; readonly content: string }[], options: { readonly signal: AbortSignal; readonly recursionLimit: number; readonly agentId?: string; readonly reflectionId?: string; readonly reflectorTarget?: ReflectionTarget }): Promise<{ readonly structuredResponse?: unknown; readonly toolExecutions?: readonly import("../../domain/contracts.js").ToolExecutionRecord[] }>;
}

export const MAX_REFLECTION_MODEL_INPUT_TOKENS = 8_000;
/**
 * A Reflector may read its Skill and several small evidence slices before it
 * returns its one structured delta.  This budget deliberately leaves room for
 * that final response instead of treating the fifth read as a terminal step.
 */
/** Session-wide ceiling for lightweight Reflector turns.  The runtime config
 * may lower it, but never raise it beyond the documented hard maximum. */
export const REFLECTION_MAX_MODEL_CALLS = 32;
// Reflection has no operational Tool loop, but the structured-output strategy
// may use several graph nodes while asking the model to repair invalid output.
// Keep this graph safety limit separate from the outer repair-attempt limit.
export const REFLECTION_RECURSION_LIMIT = 25;

export class StructuredReflectionModel implements ReflectionModel {
  constructor(private readonly invoker: ReflectionInvoker, private readonly logger: Logger = noopLogger, private readonly maxRepairs = 1, private readonly systemPrompt: string = reflectionSystemPrompt) {}

  async reflect(rawInput: ReflectionInput, signal: AbortSignal): Promise<ReflectionOutput> {
    const input = ReflectionInputSchema.parse(rawInput);
    let raw: unknown;
    let validationIssues: unknown;
    for (let attempt = 0; attempt <= this.maxRepairs; attempt += 1) {
      const content = attempt === 0
        ? JSON.stringify({ promptVersion: "reflection-v2-ja", input })
        : JSON.stringify({
          instruction: "直前の無効な出力をReflectionのフラット構造化出力へ修正してください。入力値を複製せず、変更不要な配列は空にし、Selfを変更する場合だけSelfの全fieldと根拠Memory IDを返してください。",
          allowedEventIds: input.events.map(({ id }) => id),
          allowedMemoryIds: input.memories.map(({ id }) => id),
          outputSchema: ReflectionModelOutputJsonSchema,
          validationIssues,
          invalidOutput: raw
        });
      const inputTokens = estimateTokens([{ role: "system", content: this.systemPrompt }, { role: "user", content }]) + estimateTokens(ReflectionModelOutputJsonSchema);
      if (inputTokens > MAX_REFLECTION_MODEL_INPUT_TOKENS) throw new DomainError("LIMIT_EXCEEDED", `Reflection model input exceeds estimated ${String(MAX_REFLECTION_MODEL_INPUT_TOKENS)} token budget: ${String(inputTokens)}`);
      try {
        const result = await this.invoker.invoke([{ role: "user", content }], { signal, recursionLimit: REFLECTION_RECURSION_LIMIT, agentId: input.agentId, reflectionId: input.reflectionId });
        raw = domainOutputFromModel(result.structuredResponse);
      } catch (error) {
        throw providerFailure("Reflection", error, signal);
      }
      const parsed = ReflectionOutputSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      validationIssues = parsed.error.issues.map(({ code, message, path }) => ({ code, message, path }));
      this.logger.log("warn", "reflection.output_invalid", { attempt: attempt + 1, issueCount: parsed.error.issues.length, validationIssues: JSON.stringify(validationIssues) });
    }
    throw new DomainError("VALIDATION", "Reflection output failed schema validation", { cause: { validationIssues, invalidOutput: raw } });
  }
}

const reflectionReadToolNames = new Set(["skill_read", "memory_search", "event_search", "retrieval_search", "concern_list", "concern_get", "concern_history", "relationship_search", "self_get", "user_context_get"]);

export function reflectionStructuredOutputRepairMessageFor(target?: ReflectionTarget): string {
  if (target === "memory") return "最終出力がSchema不一致です。本文、Markdown、Action、入力metadataは返さず、構造化出力専用Toolを1回だけ呼んでください。出力は memories 配列だけで、最大4件です。5件以上の候補がある場合は重要度と根拠の強さで4件に選別してください。各 target は episodic / semantic / self-related / self-change / common-ground のいずれか一つを正確に指定し、self / user は perspective にだけ使います。保存不要なら {\"memories\":[]} を返してください。";
  if (target === "reconciliation") return "最終出力がSchema不一致です。本文、Markdown、Action、入力metadataは返さず、構造化出力専用Toolを1回だけ呼んでください。出力は changes 配列だけです。変更根拠Eventはanchorより後のものだけを指定し、変更不要なら keep を返してください。";
  if (target === "concern") return "最終出力がSchema不一致です。本文、Markdown、Action、入力metadataは返さず、構造化出力専用Toolを1回だけ呼んでください。出力は concernChanges と evidenceMemoryIds だけです。変更不要なら両方を空配列にしてください。";
  if (target === "relationship") return "最終出力がSchema不一致です。本文、Markdown、Action、入力metadataは返さず、構造化出力専用Toolを1回だけ呼んでください。出力は relationshipChanges 配列だけです。変更不要なら空配列にしてください。";
  if (target === "self-mood") return "最終出力がSchema不一致です。本文、Markdown、Action、入力metadataは返さず、構造化出力専用Toolを1回だけ呼んでください。出力は mood、self、selfChangeReason、evidenceMemoryIds だけです。変更不要なら evidenceMemoryIds を空配列にし、他の任意fieldは省略してください。";
  return reflectionStructuredOutputRepairMessage;
}

export function createOllamaReflectionInvoker(config: OllamaChatConfig, logger: Logger = noopLogger, systemPrompt: string = reflectionSystemPrompt, toolRegistry?: ToolRegistry, outputSchema: z.ZodType = ReflectionModelOutputSchema, allowReadTools = true, reflectorTarget?: ReflectionTarget): ReflectionInvoker {
  const model = createOllamaChatModel({ ...config, think: "high" });
  const responseFormat = toolStrategy(modelJsonSchema(outputSchema), { handleError: (error) => {
    logger.log("warn", "reflection.structured_output_invalid", { ...errorLogContext(error), ...(reflectorTarget === undefined ? {} : { reflectorTarget }) });
    return reflectionStructuredOutputRepairMessageFor(reflectorTarget);
  } }) as unknown as ReflectionResponseFormat;
  const selected = allowReadTools ? (toolRegistry?.registered() ?? []).filter(({ name }) => reflectionReadToolNames.has(name)) : [];
  const tools = createDeepAgentTools(new ToolRegistry(selected), () => new Date(), logger, reflectionToolResultForModel);
  const agent = createDeepAgent({ model, tools, systemPrompt, responseFormat, ...(tools.length === 0 ? {} : { contextSchema: DeepAgentToolRunContextSchema }) });
  return {
    async invoke(messages, options) {
      const context = createDeepAgentToolRunContext({ agentId: options.agentId ?? "reflection", runId: options.reflectionId ?? "reflection", eventId: options.reflectionId ?? "reflection", eventKind: "internal", maxModelCalls: REFLECTION_MAX_MODEL_CALLS, maxToolCalls: 12, signal: options.signal });
      try {
        const result = await agent.invoke({ messages: [...messages] }, { signal: options.signal, recursionLimit: options.recursionLimit, context });
        return { structuredResponse: result.structuredResponse, toolExecutions: context.collector.executions };
      } catch (error) {
        // Preserve read-only tool audit records even when the model graph or
        // schema strategy fails after a tool call.
        throw new DomainError("EXTERNAL", "Reflector invocation failed", { cause: { error, toolExecutions: context.collector.executions } });
      }
    }
  };
}

export class OllamaReflectionModel extends StructuredReflectionModel {
  constructor(config: OllamaChatConfig, logger: Logger = noopLogger) {
    super(createOllamaReflectionInvoker(config, logger), logger);
  }
}

export function targetedReflectorRepairInput(input: unknown, schema: z.ZodType, validationIssues: unknown, invalidOutput: unknown): Readonly<Record<string, unknown>> {
  return {
    instruction: "直前の出力をこのReflector専用schemaへ修正する。初回と同じ固定入力だけを根拠にし、本文やMarkdownではなく構造化出力だけを返す。永続ID、局所参照、根拠IDは出力しない。通常の読み取りToolは使えない。保存不要なら必ず空配列を含む最小の有効出力を返す。",
    input: reflectionToolResultForModel(input),
    outputSchema: modelJsonSchema(schema),
    validationIssues,
    // An invalid structured output is still model-facing on the repair pass.
    // It can contain an accidentally echoed runtime handle, so apply the same
    // projection as fixed input and read-tool results.
    invalidOutput: reflectionToolResultForModel(invalidOutput ?? null)
  };
}

/** The repair path is model-facing too.  Do not accidentally reintroduce a
 * Runtime handle through a copied fixed input or invalid output. */
/** LLM-visible Reflection Tool result. The collector retains the original
 * result for audit; only the model receives this ID-free projection. */
export function reflectionToolResultForModel(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(reflectionToolResultForModel);
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  const hidden = new Set(["id", "agentId", "reflectionId", "eventId", "memoryId", "concernId", "subjectId", "evidenceEventIds", "evidenceMemoryIds", "sourceConcernId", "cursor", "nextCursor", "offset", "reconciliationAnchors", "targetSnapshots"]);
  return Object.fromEntries(Object.entries(record).flatMap(([key, nested]) => hidden.has(key) ? [] : [[key, reflectionToolResultForModel(nested)]]));
}

export { reflectionConcernContext } from "../../application/reflection-concern-context.js";

export class TargetStructuredReflectionModel {
  constructor(private readonly invoker: ReflectionInvoker, private readonly repairInvoker: ReflectionInvoker, private readonly schema: z.ZodType, private readonly prompt: string, private readonly logger: Logger) {}
  async reflect(input: unknown, signal: AbortSignal, agentId: string, reflectionId: string): Promise<ReflectorResult> {
    let raw: unknown; let issues: unknown;
    let toolExecutions: readonly import("../../domain/contracts.js").ToolExecutionRecord[] = [];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const content = attempt === 0 ? JSON.stringify(input) : JSON.stringify(targetedReflectorRepairInput(input, this.schema, issues, raw));
      if (estimateTokens([{ role: "system", content: this.prompt }, { role: "user", content }]) + estimateTokens(modelJsonSchema(this.schema)) > MAX_REFLECTION_MODEL_INPUT_TOKENS) throw new DomainError("LIMIT_EXCEEDED", `Reflector input exceeds estimated ${String(MAX_REFLECTION_MODEL_INPUT_TOKENS)} token budget`);
      let result: Awaited<ReturnType<ReflectionInvoker["invoke"]>>;
      try {
        result = await (attempt === 0 ? this.invoker : this.repairInvoker).invoke([{ role: "user", content }], { signal, recursionLimit: REFLECTION_RECURSION_LIMIT, agentId, reflectionId });
      } catch (error) {
        throw new DomainError("EXTERNAL", "Reflector invocation failed", { cause: { error, toolExecutions: [...toolExecutions, ...toolExecutionsFrom(error)] } });
      }
      toolExecutions = [...toolExecutions, ...(result.toolExecutions ?? [])];
      raw = result.structuredResponse;
      if (raw === undefined) {
        issues = [{ code: "custom", path: [], message: "Reflector returned no structured output after its Tool loop" }];
        this.logger.log("warn", "reflector.output_missing", { attempt: attempt + 1, toolExecutionCount: toolExecutions.length });
        continue;
      }
      const parsed = this.schema.safeParse(raw);
      if (parsed.success) return { output: parsed.data, toolExecutions };
      issues = parsed.error.issues.map(({ code, message, path }) => ({ code, message, path }));
      this.logger.log("warn", "reflector.output_invalid", { attempt: attempt + 1, issueCount: parsed.error.issues.length });
    }
    throw new DomainError("VALIDATION", "Reflector output failed schema validation", { cause: { validationIssues: issues, toolExecutions } });
  }
}

function toolExecutionsFrom(error: unknown): readonly import("../../domain/contracts.js").ToolExecutionRecord[] {
  if (!(error instanceof Error) || typeof error.cause !== "object" || error.cause === null || !("toolExecutions" in error.cause)) return [];
  const records = error.cause.toolExecutions;
  return Array.isArray(records) ? records as readonly import("../../domain/contracts.js").ToolExecutionRecord[] : [];
}

/**
 * Transitional target adapter: each maintenance pass commits only the delta for
 * its target.  It deliberately strips every other field before persistence.
 * The next slice replaces the shared prompt with target-specific prompts.
 */
export class OllamaTargetedReflectionModel implements TargetedReflectionModel {
  readonly #models: Readonly<Record<ReflectionTarget, TargetStructuredReflectionModel>>;
  constructor(config: OllamaChatConfig, logger: Logger = noopLogger, toolRegistry?: ToolRegistry) {
    const prompt = (target: ReflectionTarget) => `あなたはReflection Sessionの${target} Reflectorです。最初に skill_read name=reflection-${target} を読み、その指示だけに従います。通常Action、ユーザーへの発話、Web検索、外部副作用は行いません。必要な根拠を読んだら探索を終え、必ず指定された構造化出力Toolを一度呼んで完了してください。保存・変更不要なときも空配列を含む有効な構造化出力を返します。`;
    const repairPrompt = (target: ReflectionTarget) => `あなたはReflection Sessionの${target} Reflectorのrepair担当です。読み取りToolは利用できません。渡された固定入力、schema、validation issueだけを根拠にし、永続ID・局所参照・根拠IDを出力せず、必ず指定された構造化出力Toolを一度呼んで完了してください。本文、Markdown、通常Action、ユーザーへの発話、外部副作用は返しません。保存・変更不要なときも空配列を含む有効な構造化出力を返します。`;
    const schemas: Record<ReflectionTarget, z.ZodType> = { memory: MemoryReflectorOutputSchema, reconciliation: MemoryReconciliationOutputSchema, concern: ConcernReflectorOutputSchema, relationship: RelationshipReflectorOutputSchema, "self-mood": SelfMoodReflectorOutputSchema };
    this.#models = Object.fromEntries((["memory", "reconciliation", "concern", "relationship", "self-mood"] as const).map((target) => [target, new TargetStructuredReflectionModel(
      createOllamaReflectionInvoker(config, logger, prompt(target), toolRegistry, schemas[target], true, target),
      createOllamaReflectionInvoker(config, logger, repairPrompt(target), undefined, schemas[target], false, target),
      schemas[target], prompt(target), logger
    )])) as Record<ReflectionTarget, TargetStructuredReflectionModel>;
  }
  async reflect(target: ReflectionTarget, input: ReflectionInput, signal: AbortSignal): Promise<ReflectorResult> {
    const memories = input.memories.map(({ kind, summary, significance, occurredAt }) => ({ kind, summary, significance, occurredAt }));
    const scoped = target === "memory"
      ? { events: input.events.map(({ occurredAt, summary }) => ({ occurredAt, summary })) }
      : target === "reconciliation"
        ? { anchor: memories[0] }
        : target === "concern"
        ? (() => { const context = reflectionConcernContext(input); return { memories: context.memories, concerns: context.concerns, concernContext: context.stats }; })()
        : target === "relationship"
          ? { events: input.events.slice(-32).map(({ occurredAt, summary }) => ({ occurredAt, summary })), memories, relationships: input.state.relationships.map(({ description }) => ({ description })) }
          : { self: input.self, mood: input.state.mood, memories };
    // Tool call counters restart for each Reflector.  Scope the tool-run key by
    // target and, for each Memory formation batch, by its stable first Event.
    // Otherwise `tool-1` in two different batches would reuse the same
    // idempotency key with different inputs.
    return this.#models[target].reflect(scoped, signal, input.agentId, reflectionToolRunScope(target, input));
  }
}

/**
 * Returns the idempotency namespace shared by all read tools in one Reflector
 * invocation.  A Memory target runs once per Event batch, whereas the other
 * targets run only once per Reflection Session.
 */
export function reflectionToolRunScope(target: ReflectionTarget, input: Pick<ReflectionInput, "reflectionId" | "events" | "memories">): string {
  if (target === "reconciliation") {
    const anchor = input.memories[0]?.id;
    return `${input.reflectionId}:${target}:${anchor ?? "unbound"}`;
  }
  if (target !== "memory") return `${input.reflectionId}:${target}`;
  const batchAnchorEventId = input.events[0]?.id;
  return batchAnchorEventId === undefined
    ? `${input.reflectionId}:${target}:empty`
    : `${input.reflectionId}:${target}:${batchAnchorEventId}`;
}
