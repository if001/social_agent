import { createDeepAgent } from "deepagents";
import { toolStrategy, type TypedToolStrategy } from "langchain";
import { z } from "zod";

import { estimateTokens } from "../../application/context-builder.js";
import { ReflectionInputSchema, ReflectionOutputSchema, type ReflectionInput, type ReflectionModel, type ReflectionOutput } from "../../application/reflection.js";
import { DomainError } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { concernLifecyclePrompt } from "./concern-lifecycle-prompt.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";

const ReflectionMemorySchema = z.object({
  summary: z.string().trim().min(1).max(800).describe("後の判断や検索で再利用する経験の要点。会話やTool結果を転載せず、何が起き、どうなったかを具体的に1〜2文で書く"),
  significance: z.string().trim().min(1).max(400).describe("この経験を今後も覚える具体的理由。説明を繰り返さず、Self、Concern、関係、判断のどれに影響するかを1文で書く"),
  subjects: z.array(z.string().min(1)).max(12).describe("このMemoryを人物・対象から検索するためのID。入力にあるIDだけを使い、対象がなければ空配列"),
  occurredAt: z.string().describe("Memoryの時系列順と根拠追跡に使う発生日時。根拠EventのoccurredAtをそのまま使う"),
  source: z.string().trim().min(1).max(16_000).optional().describe("伝聞と直接経験を区別する情報源ID。入力に情報源が明記された伝聞だけに指定する")
}).strict().describe("今後の判断に再利用する価値がある経験。入力Eventの単なる要約は保存しない");

const ReflectionConcernChangeSchema = z.object({
  operation: z.enum(["upsert", "remove"]).describe("今後もContextへ残すならupsert、既存Concernを消すならremove"),
  id: z.string().min(1).describe("同じConcernを次回以降も識別するID。更新・削除では既存IDを使う"),
  description: z.string().trim().min(1).max(16_000).optional().describe("まだ気に掛ける未解決事項。作業手順ではなく、何が未解決かを一文で書く。upsertだけに指定する"),
  whyItMatters: z.string().trim().min(1).max(16_000).optional().describe("この未解決事項を次回以降の判断へ残す理由。現在のSelfや関係との結び付きを具体的に書く。upsertだけに指定する"),
  status: z.enum(["active", "satisfied", "abandoned"]).optional().describe("activeは継続、satisfiedは満足して完了、abandonedは取り下げ。upsertだけに指定する"),
  reconsiderAt: z.string().optional().describe("Schedulerが再検討Eventを起こす日時。入力から明確な将来時刻を決められる場合だけ指定する")
}).strict().describe("複数Eventにわたり判断へ影響する未解決事項の変更。今回だけの感想や実行手順は入れない");

const ReflectionRelationshipChangeSchema = z.object({
  operation: z.enum(["upsert", "remove"]).describe("今後の対人Contextへ残すならupsert、既存Relationshipを消すならremove"),
  subjectId: z.string().min(1).describe("関係する相手を識別する入力中のID"),
  description: z.string().trim().min(1).max(16_000).optional().describe("今後その相手への意味づけや応答へ影響する現在の関係。今回の会話内容ではなく、関係の変化を一文で書く。upsertだけに指定する")
}).strict().describe("特定の相手との持続的な関係の変更。関係が変わっていなければ出力しない");

export const ReflectionModelOutputSchema = z.object({
  memories: z.array(ReflectionMemorySchema).max(4).describe("Memory DBへ新規保存し、今後のContext検索に使う経験。保存価値がなければ空配列"),
  concernChanges: z.array(ReflectionConcernChangeSchema).max(4).describe("現在Stateのconcernsへ適用する変更。未解決事項が変わらなければ空配列"),
  relationshipChanges: z.array(ReflectionRelationshipChangeSchema).max(4).describe("現在Stateのrelationshipsへ適用する変更。関係が変わらなければ空配列"),
  mood: z.string().trim().min(1).max(16_000).optional().describe("次の複数Eventの意味づけや行動へ影響する現在の気分。短期的な感情だけなら省略する"),
  selfIdentity: z.string().trim().min(1).max(16_000).optional().describe("全Eventで使う『自分は誰か』の現在表現。十分なMemory根拠で変化した場合だけ、完全な新しい値を指定する"),
  selfDisposition: z.string().trim().min(1).max(16_000).optional().describe("全Eventで使う、価値を感じやすい対象と意味づけの傾向。十分なMemory根拠で変化した場合だけ、完全な新しい値を指定する"),
  selfStory: z.string().trim().min(1).max(16_000).optional().describe("全Eventで使う、経験から形成された現在の自己理解。十分なMemory根拠で変化した場合だけ、完全な新しい値を指定する"),
  selfCommitments: z.array(z.string().trim().min(1).max(16_000)).max(12).optional().describe("全Eventで守るもの、続ける関係、譲らないこと。十分なMemory根拠で変化した場合だけ、完全な配列を指定する"),
  selfChangeReason: z.string().trim().min(1).max(16_000).optional().describe("どの反復経験または強い経験によりSelfがどう変わったか。Selfの全fieldと一緒にだけ指定する"),
  evidenceMemoryIds: z.array(z.string().min(1)).max(16).describe("Self変更をRuntimeが検証するための根拠Memory ID。Selfを変更しない場合は空配列")
}).strict().describe("永続状態へ実際に適用する最小限の変更。入力の説明や変更のない値は出力しない");

export const ReflectionModelOutputJsonSchema = modelJsonSchema(ReflectionModelOutputSchema);
type ReflectionResponseFormat = TypedToolStrategy<z.infer<typeof ReflectionModelOutputSchema>>;

export const reflectionSystemPrompt = `あなたはAgentの経験を、次回以降の判断に必要な永続状態へ整理するReflection担当です。

目的:
- Eventの再説明ではなく、今後も使うMemory、未解決Concern、関係の変化、持続するMoodだけを残す
- Selfは、反復した経験、強い経験、または既存Selfとの明確な矛盾があるときだけ更新する

出力基準:
- Memory: 何が起き、どうなり、なぜ今後の判断に重要かを具体的に書く
- Concern: 今回では解消せず、次回以降も気に掛ける具体的な未解決事項だけを書く
- Relationship: 特定の相手との関係が実際に変化した場合だけ書く
- Mood: 一時的な感情ではなく、次の複数Eventへ残る気分だけを書く
- Self: 全EventのContextを変える長期変化。変更する場合は全field、理由、入力Memory IDを揃える

制約:
- 入力にない事実、ID、日時、関係を作らない
- 入力Eventを網羅的に要約しない。同じ内容のMemoryを重複して作らない
- 変更がなければ配列は空、任意fieldは省略する。空のmaintenance結果は正しい
- reflectionId、agentId、expectedVersion、入力Selfを出力へ複製しない
- Action、ユーザー向け応答、Markdown、説明文は返さず、指定された構造化出力だけを返す${concernLifecyclePrompt}`;

function domainOutputFromModel(raw: unknown): unknown {
  const parsed = ReflectionModelOutputSchema.safeParse(raw);
  if (!parsed.success) return raw;
  const value = parsed.data;
  const concernChanges = value.concernChanges.map((change) => change.operation === "remove"
    ? { operation: change.operation, id: change.id }
    : { operation: change.operation, concern: { id: change.id, description: change.description, whyItMatters: change.whyItMatters, status: change.status, ...(change.reconsiderAt === undefined ? {} : { reconsiderAt: change.reconsiderAt }) } });
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
  invoke(messages: readonly { readonly role: "user"; readonly content: string }[], options: { readonly signal: AbortSignal; readonly recursionLimit: number }): Promise<{ readonly structuredResponse?: unknown }>;
}

export const MAX_REFLECTION_MODEL_INPUT_TOKENS = 8_000;

export class StructuredReflectionModel implements ReflectionModel {
  constructor(private readonly invoker: ReflectionInvoker, private readonly logger: Logger = noopLogger, private readonly maxRepairs = 1) {}

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
      const inputTokens = estimateTokens([{ role: "system", content: reflectionSystemPrompt }, { role: "user", content }]) + estimateTokens(ReflectionModelOutputJsonSchema);
      if (inputTokens > MAX_REFLECTION_MODEL_INPUT_TOKENS) throw new DomainError("LIMIT_EXCEEDED", `Reflection model input exceeds estimated ${String(MAX_REFLECTION_MODEL_INPUT_TOKENS)} token budget: ${String(inputTokens)}`);
      try {
        const result = await this.invoker.invoke([{ role: "user", content }], { signal, recursionLimit: 6 });
        raw = domainOutputFromModel(result.structuredResponse);
      } catch (error) {
        throw providerFailure("Reflection", error, signal);
      }
      const parsed = ReflectionOutputSchema.safeParse(raw);
      if (parsed.success) return parsed.data;
      validationIssues = parsed.error.issues.map(({ code, message, path }) => ({ code, message, path }));
      this.logger.log("warn", "reflection.output_invalid", { attempt: attempt + 1, issueCount: parsed.error.issues.length });
    }
    throw new DomainError("VALIDATION", "Reflection output failed schema validation", { cause: { validationIssues, invalidOutput: raw } });
  }
}

export function createOllamaReflectionInvoker(config: OllamaChatConfig, logger: Logger = noopLogger): ReflectionInvoker {
  const model = createOllamaChatModel(config);
  const responseFormat = toolStrategy(ReflectionModelOutputJsonSchema, { handleError: (error) => {
    logger.log("warn", "reflection.structured_output_invalid", errorLogContext(error));
    return "構造化出力が不正です。通常の本文やMarkdownを返さず、指定Schemaの構造化出力をちょうど1件返してください。検証エラー: " + error.message;
  } }) as unknown as ReflectionResponseFormat;
  const agent = createDeepAgent({ model, tools: [], systemPrompt: reflectionSystemPrompt, responseFormat });
  return {
    async invoke(messages, options) {
      const result = await agent.invoke({ messages: [...messages] }, { signal: options.signal, recursionLimit: options.recursionLimit });
      return { structuredResponse: result.structuredResponse };
    }
  };
}

export class OllamaReflectionModel extends StructuredReflectionModel {
  constructor(config: OllamaChatConfig, logger: Logger = noopLogger) {
    super(createOllamaReflectionInvoker(config, logger), logger);
  }
}
