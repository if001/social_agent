import { createDeepAgent } from "deepagents";
import { toolStrategy, type TypedToolStrategy } from "langchain";
import { z } from "zod";

import { estimateTokens } from "../../application/context-builder.js";
import { ReflectionInputSchema, ReflectionOutputSchema, type ReflectionInput, type ReflectionModel, type ReflectionOutput } from "../../application/reflection.js";
import { DomainError } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";

const ReflectionMemorySchema = z.object({
  summary: z.string().trim().min(1).max(16_000).describe("Memoryへ残す経験の簡潔な内容"),
  significance: z.string().trim().min(1).max(16_000).describe("その経験が現在のAgentにとって重要な理由"),
  subjects: z.array(z.string().min(1)).max(12).describe("Memoryに関係する入力中の人物または対象ID。なければ空配列"),
  occurredAt: z.string().describe("経験が起きた入力EventのISO 8601日時"),
  source: z.string().trim().min(1).max(16_000).optional().describe("他Agentなど情報源が入力に明示されている場合だけ指定")
}).strict().describe("今回新しく保存するepisodic Memory");

const ReflectionConcernChangeSchema = z.object({
  operation: z.enum(["upsert", "remove"]).describe("Concernを追加・更新する場合はupsert、削除する場合はremove"),
  id: z.string().min(1).describe("変更するConcernの安定したID"),
  description: z.string().trim().min(1).max(16_000).optional().describe("upsertするConcernの内容。removeでは省略"),
  whyItMatters: z.string().trim().min(1).max(16_000).optional().describe("upsertするConcernが重要な理由。removeでは省略"),
  status: z.enum(["active", "satisfied", "abandoned"]).optional().describe("upsertするConcernの状態。removeでは省略"),
  reconsiderAt: z.string().optional().describe("再検討する明確な将来のISO 8601日時がある場合だけ指定")
}).strict().describe("持続するConcernの変更");

const ReflectionRelationshipChangeSchema = z.object({
  operation: z.enum(["upsert", "remove"]).describe("Relationshipを追加・更新する場合はupsert、削除する場合はremove"),
  subjectId: z.string().min(1).describe("関係する相手のID"),
  description: z.string().trim().min(1).max(16_000).optional().describe("upsertする現在の関係性。removeでは省略")
}).strict().describe("持続するRelationshipの変更");

export const ReflectionModelOutputSchema = z.object({
  memories: z.array(ReflectionMemorySchema).max(4).describe("今回新しく保存するMemory。不要なら空配列"),
  concernChanges: z.array(ReflectionConcernChangeSchema).max(4).describe("Concern変更。不要なら空配列"),
  relationshipChanges: z.array(ReflectionRelationshipChangeSchema).max(4).describe("Relationship変更。不要なら空配列"),
  mood: z.string().trim().min(1).max(16_000).optional().describe("次のEventにも残す気分が変化した場合だけ指定"),
  selfIdentity: z.string().trim().min(1).max(16_000).optional().describe("十分なMemory根拠によりSelfを変更する場合のidentity"),
  selfDisposition: z.string().trim().min(1).max(16_000).optional().describe("十分なMemory根拠によりSelfを変更する場合のdisposition"),
  selfStory: z.string().trim().min(1).max(16_000).optional().describe("十分なMemory根拠によりSelfを変更する場合のselfStory"),
  selfCommitments: z.array(z.string().trim().min(1).max(16_000)).max(12).optional().describe("十分なMemory根拠によりSelfを変更する場合のcommitments"),
  selfChangeReason: z.string().trim().min(1).max(16_000).optional().describe("Selfを変更する理由。Selfの全fieldを出す場合だけ必須"),
  evidenceMemoryIds: z.array(z.string().min(1)).max(16).describe("Self変更の根拠に使った入力Memory ID。Selfを変更しない場合は空配列")
}).strict().describe("Reflectionのmaintenance結果。変更不要な配列は空にし、Selfは変更時だけ全fieldを指定する");

export const ReflectionModelOutputJsonSchema = modelJsonSchema(ReflectionModelOutputSchema);
type ReflectionResponseFormat = TypedToolStrategy<z.infer<typeof ReflectionModelOutputSchema>>;

export const reflectionSystemPrompt = `あなたは一個体として経験を蓄積するAgentのReflection担当です。

Event logと既存Memoryを振り返り、重要な経験のMemory化、Concern、Relationship、Mood、Selfの長期変化を一つのmaintenance結果として返します。
単発の弱い経験だけでSelfを変更しません。Self変更には反復、強い経験、または既存Selfとの明確な矛盾を示す入力Memory IDを根拠として指定します。
事実を創作せず、入力外のIDを使いません。変更がなければ各配列を空にします。Actionやユーザー向け応答は生成しません。
reflectionId、agentId、expectedVersion、入力Selfや入力Eventそのものを出力へ複製しません。最終回答は指定されたReflection構造化出力だけを返します。`;

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
