import { and, desc, eq, isNull } from "drizzle-orm";

import type { ConcernImpact, ConcernImpactInput, ConcernReevaluationFocus, ConcernReevaluationRepository, ConcernReevaluationSource } from "../../application/concern-reevaluation.js";
import type { IdGenerator } from "../../application/ports.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { concernReevaluationBatches, concernReevaluationBatchMemories, concerns, eventExperiences, memories } from "./schema.js";

const terms = (value: string): readonly string[] => [...new Set(value.toLocaleLowerCase("ja").split(/[\s、。・,，.()（）「」『』]+/u).filter((word) => word.length >= 2))];
const cosine = (left: readonly number[] | null, right: readonly number[] | null): number => left === null || right === null || left.length !== right.length || left.length === 0 ? 0 : left.reduce((sum, value, index) => sum + value * (right[index] ?? 0), 0) / Math.sqrt(left.reduce((sum, value) => sum + value * value, 0) * right.reduce((sum, value) => sum + value * value, 0));

/** Persistent side of one Event-derived concern impact assessment. */
export class PostgresConcernReevaluationBatchRepository implements ConcernReevaluationRepository {
  constructor(private readonly database: RuntimeDatabase, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly aggregationMs = 300_000) {}

  async begin(source: ConcernReevaluationSource): Promise<"created" | "retry" | "existing"> {
    const id = this.ids.next(); const at = this.now();
    return this.database.transaction(async (tx) => {
      const inserted = await tx.insert(concernReevaluationBatches).values({ id, agentId: source.agentId, sourceKind: source.sourceKind, sourceId: source.sourceId, sourceEventId: source.sourceEventId ?? null, sourceRunId: source.sourceRunId ?? null, status: "assessing", createdAt: at, updatedAt: at }).onConflictDoNothing({ target: [concernReevaluationBatches.agentId, concernReevaluationBatches.sourceKind, concernReevaluationBatches.sourceId] }).returning({ id: concernReevaluationBatches.id });
      if (inserted.length === 0) {
        const existing = (await tx.select({ status: concernReevaluationBatches.status }).from(concernReevaluationBatches).where(and(
          eq(concernReevaluationBatches.agentId, source.agentId),
          eq(concernReevaluationBatches.sourceKind, source.sourceKind),
          eq(concernReevaluationBatches.sourceId, source.sourceId)
        )).limit(1))[0];
        if (existing?.status !== "failed") return "existing";
        await tx.update(concernReevaluationBatches).set({ status: "assessing", failureReason: null, nextDueAt: null, leaseUntil: null, updatedAt: at }).where(and(
          eq(concernReevaluationBatches.agentId, source.agentId),
          eq(concernReevaluationBatches.sourceKind, source.sourceKind),
          eq(concernReevaluationBatches.sourceId, source.sourceId)
        ));
        return "retry";
      }
      await tx.insert(concernReevaluationBatchMemories).values(source.memoryIds.map((memoryId) => ({ batchId: id, memoryId, createdAt: at }))).onConflictDoNothing();
      return "created";
    });
  }

  async focus(source: ConcernReevaluationSource): Promise<ConcernReevaluationFocus | undefined> {
    const written = await this.#memories(source);
    if (written.length === 0) return undefined;
    const active = await this.database.db.select().from(concerns).where(and(eq(concerns.agentId, source.agentId), eq(concerns.status, "active"), isNull(concerns.deletedAt)));
    const words = written.flatMap(({ content }) => terms(content));
    const embedding = written.find(({ embeddingStatus, embedding }) => embeddingStatus === "ready" && embedding !== null)?.embedding ?? null;
    const selected = active.map((concern) => {
      const text = `${concern.description} ${concern.whyItMatters}`.toLocaleLowerCase("ja");
      const keyword = words.reduce((score, word) => score + (text.includes(word) ? 1 : 0), 0);
      const semantic = concern.embeddingStatus === "ready" ? cosine(embedding, concern.embedding) : 0;
      return { concern, score: semantic * 10 + keyword };
    }).filter(({ score }) => score > 0).sort((left, right) => right.score - left.score || left.concern.id.localeCompare(right.concern.id))[0]?.concern;
    return selected === undefined ? undefined : { concernId: selected.id, description: selected.description, whyItMatters: selected.whyItMatters };
  }

  async input(source: ConcernReevaluationSource, focus: ConcernReevaluationFocus): Promise<ConcernImpactInput> {
    const [written, eventExperience] = await Promise.all([
      this.#memories(source),
      source.sourceEventId === undefined ? Promise.resolve(undefined) : this.database.db.select({ summary: eventExperiences.summary }).from(eventExperiences).where(eq(eventExperiences.eventId, source.sourceEventId)).limit(1).then((rows) => rows[0])
    ]);
    return { source, focus: { description: focus.description, whyItMatters: focus.whyItMatters }, experienceSummary: eventExperience?.summary ?? written.map(({ content }) => content).join(" / ").slice(0, 800), memories: written.slice(0, 3).map(({ content, importance }) => ({ content: content.slice(0, 400), importance: importance.slice(0, 240) })) };
  }

  async discard(source: ConcernReevaluationSource, reason: string): Promise<void> { await this.#update(source, { status: "discarded", impactReason: reason, failureReason: null, nextDueAt: null, leaseUntil: null }); }
  async pending(source: ConcernReevaluationSource, focus: ConcernReevaluationFocus, impact: ConcernImpact): Promise<void> { await this.#update(source, { status: "pending", focusConcernId: focus.concernId, impactReason: impact.reason, failureReason: null, nextDueAt: new Date(this.now().getTime() + this.aggregationMs), leaseUntil: null }); }
  async fail(source: ConcernReevaluationSource, error: unknown): Promise<void> { await this.#update(source, { status: "failed", failureReason: error instanceof Error ? error.message : String(error), nextDueAt: this.now(), leaseUntil: null }); }

  async #memories(source: ConcernReevaluationSource) {
    const batch = await this.database.db.select({ id: concernReevaluationBatches.id }).from(concernReevaluationBatches).where(and(eq(concernReevaluationBatches.agentId, source.agentId), eq(concernReevaluationBatches.sourceKind, source.sourceKind), eq(concernReevaluationBatches.sourceId, source.sourceId))).limit(1);
    const id = batch[0]?.id; if (id === undefined) return [];
    return this.database.db.select({ content: memories.content, importance: memories.importance, embedding: memories.embedding, embeddingStatus: memories.embeddingStatus }).from(concernReevaluationBatchMemories).innerJoin(memories, eq(memories.id, concernReevaluationBatchMemories.memoryId)).where(eq(concernReevaluationBatchMemories.batchId, id)).orderBy(desc(memories.updatedAt), desc(memories.id));
  }

  async #update(source: ConcernReevaluationSource, values: Partial<typeof concernReevaluationBatches.$inferInsert>): Promise<void> {
    await this.database.db.update(concernReevaluationBatches).set({ ...values, updatedAt: this.now() }).where(and(eq(concernReevaluationBatches.agentId, source.agentId), eq(concernReevaluationBatches.sourceKind, source.sourceKind), eq(concernReevaluationBatches.sourceId, source.sourceId)));
  }
}
