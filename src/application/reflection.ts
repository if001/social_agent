import { z } from "zod";

import { AgentStateSchema, ConcernChangeSchema, EpisodicMemorySchema, MemoryIntentSchema, RelationshipChangeSchema, SelfSchema, DomainError, type ToolExecutionRecord } from "../domain/contracts.js";

const Id = z.string().trim().min(1);
const Text = z.string().trim().min(1).max(16_000);

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
  memories: z.array(EpisodicMemorySchema)
});
export type ReflectionInput = z.infer<typeof ReflectionInputSchema>;
export const ReflectionMemoryBatchSchema = z.object({
  batchIndex: z.number().int().nonnegative(),
  events: z.array(z.object({ id: Id, occurredAt: z.iso.datetime({ offset: true }), summary: Text })).min(1).max(32)
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
  self: ReflectionTargetStatusSchema,
  relationship: ReflectionTargetStatusSchema,
  concern: ReflectionTargetStatusSchema,
  errors: z.array(z.object({ target: z.enum(["memory", "self", "relationship", "concern"]), message: Text })).default([])
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
export const ReflectionTargetSchema = z.enum(["memory", "concern", "relationship", "self-mood"]);
export type ReflectionTarget = z.infer<typeof ReflectionTargetSchema>;
const targetOrder: readonly ReflectionTarget[] = ["memory", "concern", "relationship", "self-mood"];

export const ReflectionMemoryIntentSchema = MemoryIntentSchema.safeExtend({
  evidenceEventIds: z.array(Id).min(1).max(16).describe("このMemoryを直接支持する今回のReflection Session内Event ID。網羅的な要約ではなく、事実・経験・傾向を述べる、確認する、または修正するEventだけを発生順で選ぶ"),
  subjects: z.array(Id).max(16).describe("このMemoryが主に関わる主体ID。今回の経験に現れない主体を補わない"),
  source: Text.optional().describe("このMemoryの由来となるAgent ID。必要な場合だけ入力済みの主体を使う")
}).strict().superRefine((value, context) => {
  if (new Set(value.evidenceEventIds).size !== value.evidenceEventIds.length) context.addIssue({ code: "custom", path: ["evidenceEventIds"], message: "Memory evidence Event IDs must be distinct" });
});
export const MemoryReflectorOutputSchema = z.object({
  memories: z.array(ReflectionMemoryIntentSchema).max(4).describe("今後の判断に再利用する、根拠Eventを選別済みのMemoryIntent。保存不要なら空配列")
}).strict();
export const ConcernReflectorOutputSchema = z.object({
  concernChanges: z.array(ConcernChangeSchema).max(4).describe("Memory根拠に基づくConcern差分。変更不要なら空配列"),
  evidenceMemoryIds: z.array(Id).max(16).describe("新規Concernまたは整理の根拠Memory ID")
}).strict().superRefine((value, context) => {
  if (value.concernChanges.filter((change) => change.operation === "create").length > 3) context.addIssue({ code: "custom", path: ["concernChanges"], message: "Reflection can create at most three Concerns at once" });
  if (value.concernChanges.some((change) => change.operation === "create") && value.evidenceMemoryIds.length === 0) context.addIssue({ code: "custom", path: ["evidenceMemoryIds"], message: "New Concerns require Memory evidence" });
});
export const RelationshipReflectorOutputSchema = z.object({
  relationshipChanges: z.array(RelationshipChangeSchema).max(4).describe("持続的なRelationship差分。変更不要なら空配列")
}).strict();
export const SelfMoodReflectorOutputSchema = z.object({
  mood: Text.optional().describe("複数Eventへ残る背景的Mood。変化がなければ省略"),
  self: SelfSchema.optional().describe("十分なMemory根拠がある場合だけの完全なSelf"),
  selfChangeReason: Text.optional().describe("Selfを変えるMemory根拠と理由"),
  evidenceMemoryIds: z.array(Id).max(16).describe("Self変更の根拠Memory ID")
}).strict().superRefine((value, context) => {
  if ((value.self === undefined) !== (value.selfChangeReason === undefined)) context.addIssue({ code: "custom", path: ["selfChangeReason"], message: "Self changes require an explicit reason" });
  if (value.self !== undefined && value.evidenceMemoryIds.length === 0) context.addIssue({ code: "custom", path: ["evidenceMemoryIds"], message: "Self changes require Memory evidence" });
});
export const ReflectionTargetOutputSchema = z.union([MemoryReflectorOutputSchema, ConcernReflectorOutputSchema, RelationshipReflectorOutputSchema, SelfMoodReflectorOutputSchema]);

export interface TargetedReflectionModel {
  reflect(target: ReflectionTarget, input: ReflectionInput, signal: AbortSignal): Promise<ReflectorResult>;
}
export type ReflectorResult = { readonly output: unknown; readonly toolExecutions: readonly ToolExecutionRecord[] };

export interface TargetedReflectionRepository {
  load(reflectionId: string, agentId: string): Promise<ReflectionInput | undefined>;
  refresh(input: ReflectionInput): Promise<ReflectionInput>;
  beginTarget(input: ReflectionInput, target: ReflectionTarget): Promise<"pending" | "completed">;
  memoryBatches(input: ReflectionInput): Promise<readonly ReflectionMemoryBatch[]>;
  beginMemoryBatch(input: ReflectionInput, batch: ReflectionMemoryBatch): Promise<"pending" | "completed">;
  commitMemoryBatch(input: ReflectionInput, batch: ReflectionMemoryBatch, result: ReflectorResult): Promise<void>;
  failMemoryBatch(input: ReflectionInput, batch: ReflectionMemoryBatch, error: unknown): Promise<void>;
  completeMemoryTarget(input: ReflectionInput): Promise<void>;
  commitTarget(input: ReflectionInput, target: ReflectionTarget, output: unknown): Promise<void>;
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
      if (!memoryReady) { await this.repository.blockTarget(input, target); continue; }
      if (target === "self-mood" && !integrationReady) { await this.repository.blockTarget(input, target); continue; }
      // A retry skips durable completed targets, but must still read their
      // effects before the next pending target decides from this Session.
      if (await this.repository.beginTarget(input, target) === "completed") {
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
      try {
        const result = await this.model.reflect(target, input, signal);
        this.#validateTargetOutput(target, result.output, input);
        await this.repository.commitTarget(input, target, result);
        input = await this.repository.refresh(input);
      } catch (error) {
        await this.repository.failTarget(input, target, error);
        if (target === "concern" || target === "relationship") integrationReady = false;
      }
    }
    await this.repository.complete(input);
  }

  #validateTargetOutput(target: ReflectionTarget, raw: unknown, input: ReflectionInput): void {
    const memoryIds = new Set(input.memories.map(({ id }) => id));
    if (target === "concern") {
      const output = ConcernReflectorOutputSchema.parse(raw);
      if (output.evidenceMemoryIds.some((id) => !memoryIds.has(id))) throw new DomainError("VALIDATION", "Concern Reflector referenced Memory outside its Session");
      const concernIds = new Set(input.state.concerns.map(({ id }) => id));
      for (const change of output.concernChanges) {
        if (change.operation === "create") continue;
        const id = change.operation === "remove" ? change.id : change.concern.id;
        if (!concernIds.has(id)) throw new DomainError("VALIDATION", `Concern Reflector referenced an unknown Concern: ${id}`);
      }
    } else if (target === "self-mood") {
      const output = SelfMoodReflectorOutputSchema.parse(raw);
      if (output.evidenceMemoryIds.some((id) => !memoryIds.has(id))) throw new DomainError("VALIDATION", "Self/Mood Reflector referenced Memory outside its Session");
    } else if (target === "memory") {
      const output = MemoryReflectorOutputSchema.parse(raw);
      const eventIds = new Set(input.events.map(({ id }) => id));
      for (const memory of output.memories) if (memory.evidenceEventIds.some((id) => !eventIds.has(id))) throw new DomainError("VALIDATION", "Memory Reflector referenced Event outside its Session");
    }
    else RelationshipReflectorOutputSchema.parse(raw);
  }
}
