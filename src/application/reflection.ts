import { z } from "zod";

import { AgentStateSchema, ConcernChangeSchema, CurrentRelationshipDescriptionSchema, EpisodicMemorySchema, MemoryIntentSchema, MemoryIntentTargetSchema, MemoryPerspectiveSchema, RelationshipChangeSchema, SelfSchema, DomainError, type ToolExecutionRecord } from "../domain/contracts.js";

const Id = z.string().trim().min(1);
const Text = z.string().trim().min(1).max(16_000);
const ReflectionTargetSnapshotSchema = z.object({
  self: SelfSchema,
  state: AgentStateSchema,
  events: z.array(z.object({ id: Id, occurredAt: z.iso.datetime({ offset: true }), summary: Text })),
  memories: z.array(EpisodicMemorySchema)
});

export const ReflectionInputSchema = z.object({
  reflectionId: Id,
  agentId: Id,
  // The exclusive upper bound is captured before selecting Events.  It is
  // retained with the Session so retry and the next Session cannot mix in
  // Events that arrived while Reflection was running.  Older stored Sessions
  // predate this field and remain readable.
  eventWindowEnd: z.iso.datetime({ offset: true }).optional(),
  expectedVersion: z.number().int().nonnegative(),
  self: SelfSchema,
  state: AgentStateSchema,
  events: z.array(z.object({ id: Id, occurredAt: z.iso.datetime({ offset: true }), summary: Text })).min(1),
  memories: z.array(EpisodicMemorySchema),
  /** Runtime-selected Reconciliation anchors are appended once to the
   * canonical Session snapshot so out-of-window anchors remain audited. */
  reconciliationAnchors: z.array(EpisodicMemorySchema).optional(),
  /** Exact post-pass input snapshots live only on the parent Session. */
  targetSnapshots: z.record(z.string(), ReflectionTargetSnapshotSchema).optional()
});
export type ReflectionInput = z.infer<typeof ReflectionInputSchema>;
export const ReflectionMemoryBatchSchema = z.object({
  batchIndex: z.number().int().nonnegative(),
  events: z.array(z.object({ id: Id, occurredAt: z.iso.datetime({ offset: true }), summary: Text })).min(1).max(16)
}).strict();
export type ReflectionMemoryBatch = z.infer<typeof ReflectionMemoryBatchSchema>;

export const ReflectionOutputSchema = z.object({
  memories: z.array(EpisodicMemorySchema.omit({ id: true, createdAt: true })),
  concernChanges: z.array(ConcernChangeSchema),
  relationshipChanges: z.array(RelationshipChangeSchema),
  mood: Text.optional(),
  self: SelfSchema.optional(),
  selfChangeReason: Text.optional(),
  evidenceMemoryIds: z.array(Id).default([])
}).superRefine((value, context) => {
  if ((value.self === undefined) !== (value.selfChangeReason === undefined)) context.addIssue({ code: "custom", path: ["selfChangeReason"], message: "Self changes require an explicit reason" });
  if (value.self !== undefined && value.evidenceMemoryIds.length === 0) context.addIssue({ code: "custom", path: ["evidenceMemoryIds"], message: "Self changes require Memory evidence" });
  const createdConcerns = value.concernChanges.filter((change) => change.operation === "create");
  if (createdConcerns.length > 3) context.addIssue({ code: "custom", path: ["concernChanges"], message: "Reflection can create at most three Concerns at once" });
  if (createdConcerns.length > 0 && value.evidenceMemoryIds.length === 0) context.addIssue({ code: "custom", path: ["evidenceMemoryIds"], message: "New Concerns require Memory evidence" });
});
export type ReflectionOutput = z.infer<typeof ReflectionOutputSchema>;

export const ReflectionTargetStatusSchema = z.enum(["pending", "completed", "failed", "blocked"]);
export const ReflectionPlanSchema = z.object({
  memory: ReflectionTargetStatusSchema,
  reconciliation: ReflectionTargetStatusSchema.default("pending"),
  self: ReflectionTargetStatusSchema,
  relationship: ReflectionTargetStatusSchema,
  concern: ReflectionTargetStatusSchema,
  errors: z.array(z.object({ target: z.enum(["memory", "reconciliation", "self", "relationship", "concern"]), message: Text })).default([])
}).strict();
export type ReflectionPlan = z.infer<typeof ReflectionPlanSchema>;

export interface ReflectionModel { reflect(input: ReflectionInput, signal: AbortSignal): Promise<ReflectionOutput>; }
export interface ReflectionRepository {
  load(reflectionId: string, agentId: string): Promise<ReflectionInput | undefined>;
  commit(input: ReflectionInput, output: ReflectionOutput): Promise<"committed" | "duplicate">;
  fail(input: ReflectionInput, error: unknown): Promise<void>;
}

export class Reflection {
  constructor(private readonly repository: ReflectionRepository, private readonly model: ReflectionModel) {}

  async process(reflectionId: string, agentId: string, signal: AbortSignal): Promise<ReflectionOutput | undefined> {
    const loaded = await this.repository.load(reflectionId, agentId);
    if (loaded === undefined) return undefined;
    const input = ReflectionInputSchema.parse(loaded);
    try {
      const output = ReflectionOutputSchema.parse(await this.model.reflect(input, signal));
      const knownMemories = new Set(input.memories.map(({ id }) => id));
      if (output.evidenceMemoryIds.some((id) => !knownMemories.has(id))) throw new DomainError("VALIDATION", "Reflection referenced Memory outside its input");
      const knownConcerns = new Set(input.state.concerns.map(({ id }) => id));
      for (const change of output.concernChanges) {
        if (change.operation === "create") continue;
        const id = change.operation === "remove" ? change.id : change.concern.id;
        if (!knownConcerns.has(id)) throw new DomainError("VALIDATION", `Reflection referenced an unknown Concern: ${id}`);
      }
      await this.repository.commit(input, output);
      return output;
    } catch (error) {
      await this.repository.fail(input, error);
      throw error;
    }
  }
}

/** A Reflection Session's maintenance targets.  These are deliberately not Agent
 * actions: every target may only return a persisted long-term-state delta. */
export const ReflectionTargetSchema = z.enum(["memory", "reconciliation", "concern", "relationship", "self-mood"]);
export type ReflectionTarget = z.infer<typeof ReflectionTargetSchema>;
const targetOrder: readonly ReflectionTarget[] = ["memory", "reconciliation", "concern", "relationship", "self-mood"];

/**
 * A Memory Reflector chooses reusable experience and its direct evidence.
 * Storage policy (confidence / purpose) is intentionally derived by the
 * commit layer rather than asking the model to repeat it.
 */
export const ReflectionMemoryIntentSchema = z.object({
  content: MemoryIntentSchema.shape.content.describe("今後の検索と判断に再利用する、固定Event窓から分かる具体的で短い経験の要点"),
  reason: MemoryIntentSchema.shape.reason.describe("この経験を残すことで次回以降に変わる判断・問いかけ・探索を具体的に書く"),
  target: MemoryIntentTargetSchema.describe("この経験を保存するMemory kind。必ず episodic / semantic / self-related / self-change / common-ground のいずれかを正確に指定する。perspective の self / user や Relationship / Concern は指定しない"),
  perspective: MemoryPerspectiveSchema.describe("userは対話相手について確認できた事実、selfはAgent自身の探索・行動・判断から得た経験として保存する。根拠EventとsubjectはRuntimeが固定Event窓から解決する")
}).strict();
export const MemoryReflectorOutputSchema = z.object({
  memories: z.array(ReflectionMemoryIntentSchema).max(4).describe("今後の判断に再利用する、根拠Eventを選別済みのMemoryIntent。最大4件まで返す。候補が5件以上なら、今後の判断への影響と根拠の強さで上位4件だけを選び、残りは次回のReflectionへ回す。保存不要なら空配列")
}).strict();
export type ReflectionMemoryIntent = z.infer<typeof ReflectionMemoryIntentSchema>;

/**
 * Runtime-owned Formation resolver.  The model supplies only a candidate in
 * natural language; this resolver is the sole place that binds it to the
 * fixed Event window.  A candidate with no lexical support is an ordinary
 * no-op, never a model retry.
 */
export function resolveFormationEvidence(candidate: Pick<ReflectionMemoryIntent, "content" | "reason">, events: readonly Pick<ReflectionInput["events"][number], "id" | "summary">[]): readonly string[] {
  const terms = new Set(`${candidate.content} ${candidate.reason}`.split(/[\s、。,.!?！？「」()（）]+/).filter((term) => term.length >= 2));
  const scored = events.map((event) => ({ id: event.id, score: [...terms].filter((term) => event.summary.includes(term)).length }));
  return scored.filter(({ score }) => score > 0).sort((left, right) => right.score - left.score || left.id.localeCompare(right.id)).slice(0, 16).map(({ id }) => id);
}
export const MemoryReconciliationChangeSchema = z.object({
  operation: z.enum(["keep", "update", "split"]).describe("keepは維持、updateは確認・訂正・弱化、splitは混在した長期Memoryを二つの独立Memoryに分ける。episodicは必ずkeep"),
  content: MemoryIntentSchema.shape.content.optional().describe("updateまたはsplit後に残す、将来の検索に使う短いMemory本文。keepでは省略"),
  reason: MemoryIntentSchema.shape.reason.describe("今回の再検討の理由。どの根拠が確認・訂正・反復を示すかを書く"),
  split: z.array(z.object({ content: MemoryIntentSchema.shape.content, reason: MemoryIntentSchema.shape.reason }).strict()).min(2).max(2).optional().describe("operation=splitのときだけ、元Memoryから分けて新規作成する二つの本文と意義")
}).strict().superRefine((value, context) => {
  if (value.operation === "update" && value.content === undefined) context.addIssue({ code: "custom", path: ["content"], message: "update requires content" });
  if (value.operation === "split" && value.split === undefined) context.addIssue({ code: "custom", path: ["split"], message: "split requires two memories" });
});
export const MemoryReconciliationOutputSchema = z.object({
  changes: z.array(MemoryReconciliationChangeSchema).max(1).describe("Runtimeが暗黙に束縛した一件のanchor Memoryの再検討結果。anchor・根拠Event・関連MemoryのIDは出力しない。変更不要ならkeepを一件だけ返す")
}).strict();
export const ConcernReflectorOutputSchema = z.object({
  concernChanges: z.array(z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("create"), description: Text, whyItMatters: Text, reconsiderAt: z.iso.datetime({ offset: true }).optional() }).strict(),
    z.object({ operation: z.literal("upsert"), currentDescription: Text.describe("更新対象を示す現在のConcern本文。IDや局所参照ではない"), description: Text, whyItMatters: Text, status: z.enum(["active", "satisfied", "abandoned"]), reconsiderAt: z.iso.datetime({ offset: true }).optional() }).strict(),
    z.object({ operation: z.literal("remove"), currentDescription: Text.describe("削除対象を示す現在のConcern本文。IDや局所参照ではない") }).strict()
  ])).max(4).describe("Memory根拠に基づくConcern差分。ID・根拠Memory IDは出力しない。変更不要なら空配列")
}).strict().superRefine((value, context) => {
  if (value.concernChanges.filter((change) => change.operation === "create").length > 3) context.addIssue({ code: "custom", path: ["concernChanges"], message: "Reflection can create at most three Concerns at once" });
});
export const RelationshipReflectorOutputSchema = z.object({
  relationshipChanges: z.array(z.discriminatedUnion("operation", [
    z.object({ operation: z.literal("upsert"), currentDescription: CurrentRelationshipDescriptionSchema.describe("更新対象を示す現在のRelationship本文。IDや局所参照ではない"), description: CurrentRelationshipDescriptionSchema }).strict(),
    z.object({ operation: z.literal("remove"), currentDescription: CurrentRelationshipDescriptionSchema.describe("削除対象を示す現在のRelationship本文。IDや局所参照ではない") }).strict()
  ])).max(4).describe("持続的なRelationship差分。Runtimeが本文から対象を解決する。新規の対象IDは作らない")
}).strict();
export const SelfMoodReflectorOutputSchema = z.object({
  mood: Text.optional().describe("複数Eventへ残る背景的Mood。変化がなければ省略"),
  self: SelfSchema.optional().describe("十分なMemory根拠がある場合だけの完全なSelf"),
  selfChangeReason: Text.optional().describe("Selfを変える複数経験の内容と理由。Memory IDや局所参照は出力しない")
}).strict().superRefine((value, context) => {
  if ((value.self === undefined) !== (value.selfChangeReason === undefined)) context.addIssue({ code: "custom", path: ["selfChangeReason"], message: "Self changes require an explicit reason" });
});
export const ReflectionTargetOutputSchema = z.union([MemoryReflectorOutputSchema, MemoryReconciliationOutputSchema, ConcernReflectorOutputSchema, RelationshipReflectorOutputSchema, SelfMoodReflectorOutputSchema]);

export interface TargetedReflectionModel {
  reflect(target: ReflectionTarget, input: ReflectionInput, signal: AbortSignal): Promise<ReflectorResult>;
}
export type ReflectorResult = { readonly output: unknown; readonly toolExecutions: readonly ToolExecutionRecord[] };

export interface TargetedReflectionRepository {
  load(reflectionId: string, agentId: string): Promise<ReflectionInput | undefined>;
  refresh(input: ReflectionInput): Promise<ReflectionInput>;
  reconciliationInput?(input: ReflectionInput): Promise<ReflectionInput>;
  beginTarget(input: ReflectionInput, target: ReflectionTarget): Promise<"pending" | "completed">;
  memoryBatches(input: ReflectionInput): Promise<readonly ReflectionMemoryBatch[]>;
  beginMemoryBatch(input: ReflectionInput, batch: ReflectionMemoryBatch): Promise<"pending" | "completed">;
  commitMemoryBatch(input: ReflectionInput, batch: ReflectionMemoryBatch, result: ReflectorResult): Promise<void>;
  failMemoryBatch(input: ReflectionInput, batch: ReflectionMemoryBatch, error: unknown): Promise<void>;
  completeMemoryTarget(input: ReflectionInput): Promise<void>;
  commitTarget(input: ReflectionInput, target: ReflectionTarget, output: unknown): Promise<void>;
  completeTarget?(input: ReflectionInput, target: ReflectionTarget): Promise<void>;
  failTarget(input: ReflectionInput, target: ReflectionTarget, error: unknown): Promise<void>;
  blockTarget(input: ReflectionInput, target: ReflectionTarget): Promise<void>;
  complete(input: ReflectionInput): Promise<void>;
  fail(input: ReflectionInput, error: unknown): Promise<void>;
}

/**
 * Runs a Session as dependent maintenance passes.  A failed target is retained
 * for a later Session; only its downstream dependants are blocked this time.
 */
export class TargetedReflection {
  constructor(private readonly repository: TargetedReflectionRepository, private readonly model: TargetedReflectionModel) {}

  async process(reflectionId: string, agentId: string, signal: AbortSignal): Promise<void> {
    let input = await this.repository.load(reflectionId, agentId);
    if (input === undefined) return;
    let memoryReady = true;
    let integrationReady = true;
    for (const target of targetOrder) {
      // Older repository adapters intentionally do not provide reconciliation;
      // keeping it optional preserves their Formation-only contract.
      if (target === "reconciliation" && this.repository.reconciliationInput === undefined) continue;
      if (!memoryReady) { await this.repository.blockTarget(input, target); continue; }
      if ((target === "self-mood" || target === "concern" || target === "relationship") && !integrationReady) { await this.repository.blockTarget(input, target); continue; }
      // A retry skips durable completed targets, but must still read their
      // effects before the next pending target decides from this Session.
      const targetInput = target === "reconciliation" && this.repository.reconciliationInput !== undefined ? await this.repository.reconciliationInput(input) : input;
      if (await this.repository.beginTarget(targetInput, target) === "completed") {
        input = await this.repository.refresh(input);
        continue;
      }
      if (target === "memory") {
        for (const batch of await this.repository.memoryBatches(input)) {
          if (await this.repository.beginMemoryBatch(input, batch) === "completed") continue;
          const batchInput = { ...input, events: batch.events };
          try {
            const result = await this.model.reflect("memory", batchInput, signal);
            this.#validateTargetOutput("memory", result.output, batchInput);
            await this.repository.commitMemoryBatch(input, batch, result);
            input = await this.repository.refresh(input);
          } catch (error) {
            await this.repository.failMemoryBatch(input, batch, error);
            await this.repository.failTarget(input, "memory", error);
            memoryReady = false;
            break;
          }
        }
        if (memoryReady) { await this.repository.completeMemoryTarget(input); input = await this.repository.refresh(input); }
        continue;
      }
      if (target === "reconciliation") {
        // The Runtime selects every anchor before the model runs.  Each call
        // receives one bound anchor, so the model never has to name a Memory
        // (nor an Event) in its structured output.
        for (const anchor of targetInput.memories) {
          const anchorInput = { ...targetInput, memories: [anchor] };
          try {
            const result = await this.model.reflect(target, anchorInput, signal);
            this.#validateTargetOutput(target, result.output, anchorInput);
            await this.repository.commitTarget(anchorInput, target, result);
            input = await this.repository.refresh(input);
          } catch (error) {
            await this.repository.failTarget(anchorInput, target, error);
            integrationReady = false;
            break;
          }
        }
        if (integrationReady) await this.repository.completeTarget?.(input, target);
        continue;
      }
      try {
        const result = await this.model.reflect(target, targetInput, signal);
        this.#validateTargetOutput(target, result.output, targetInput);
        await this.repository.commitTarget(targetInput, target, result);
        input = await this.repository.refresh(input);
      } catch (error) {
        await this.repository.failTarget(input, target, error);
        if (target === "concern" || target === "relationship") integrationReady = false;
      }
    }
    await this.repository.complete(input);
  }

  #validateTargetOutput(target: ReflectionTarget, raw: unknown, input: ReflectionInput): void {
    if (target === "reconciliation") {
      const output = MemoryReconciliationOutputSchema.parse(raw);
      if (input.memories.length !== 1) throw new DomainError("VALIDATION", "Memory Reconciliation requires one Runtime-bound anchor");
      const anchor = input.memories[0];
      if (anchor === undefined) throw new DomainError("VALIDATION", "Memory Reconciliation anchor was not loaded");
      for (const change of output.changes) {
        if (anchor.kind === "episodic" && change.operation !== "keep") throw new DomainError("VALIDATION", "Episodic Memory is immutable during Reconciliation");
      }
    } else if (target === "concern") {
      ConcernReflectorOutputSchema.parse(raw);
    } else if (target === "self-mood") {
      SelfMoodReflectorOutputSchema.parse(raw);
    } else if (target === "memory") {
      MemoryReflectorOutputSchema.parse(raw);
    }
    else RelationshipReflectorOutputSchema.parse(raw);
  }
}
