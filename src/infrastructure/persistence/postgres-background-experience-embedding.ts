import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";

import type { EmbeddingProvider } from "../../application/ports.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { backgroundExperiences } from "./schema.js";

export type BackgroundExperienceEmbeddingResult = { readonly attempted: number; readonly ready: number; readonly failed: number };

const content = (row: Pick<typeof backgroundExperiences.$inferSelect, "place" | "relationship" | "action" | "feeling" | "outcome" | "lesson">) =>
  [row.place, row.relationship, row.action, row.feeling, row.outcome, row.lesson].join(" ");

export class PostgresBackgroundExperienceEmbeddingLifecycle {
  constructor(private readonly database: RuntimeDatabase, private readonly provider: EmbeddingProvider, private readonly model: string) {}

  async embedIds(agentId: string, ids: readonly string[], signal: AbortSignal = new AbortController().signal): Promise<BackgroundExperienceEmbeddingResult> {
    const uniqueIds = [...new Set(ids)];
    if (uniqueIds.length === 0) return { attempted: 0, ready: 0, failed: 0 };
    const pending = await this.database.db.select().from(backgroundExperiences).where(and(
      eq(backgroundExperiences.agentId, agentId), inArray(backgroundExperiences.id, uniqueIds),
      or(isNull(backgroundExperiences.embedding), ne(backgroundExperiences.embeddingStatus, "ready"))
    )).orderBy(asc(backgroundExperiences.occurredAt), asc(backgroundExperiences.id));
    if (pending.length === 0) return { attempted: 0, ready: 0, failed: 0 };
    const pendingIds = pending.map(({ id }) => id);
    const attemptedAt = new Date();
    await this.database.db.update(backgroundExperiences).set({
      embeddingLastAttemptAt: attemptedAt, embeddingError: null, updatedAt: attemptedAt
    }).where(and(eq(backgroundExperiences.agentId, agentId), inArray(backgroundExperiences.id, pendingIds)));
    try {
      const vectors = await this.provider.embed(pending.map(content), signal);
      for (let index = 0; index < pending.length; index += 1) {
        const row = pending[index]; const vector = vectors[index];
        if (row === undefined || vector === undefined || vector.length !== this.provider.dimension) throw new Error("Embedding provider returned an invalid vector batch");
        await this.database.db.update(backgroundExperiences).set({
          embedding: [...vector], embeddingModel: this.model,
          embeddingDimension: this.provider.dimension, embeddingStatus: "ready",
          embeddingError: null, updatedAt: new Date()
        }).where(and(eq(backgroundExperiences.id, row.id), eq(backgroundExperiences.agentId, agentId)));
      }
      return { attempted: pending.length, ready: pending.length, failed: 0 };
    } catch (error) {
      const message = (error instanceof Error ? error.message : "Embedding generation failed").slice(0, 2_000);
      await this.database.db.update(backgroundExperiences).set({
        embedding: null, embeddingModel: null, embeddingDimension: null,
        embeddingStatus: "failed", embeddingError: message, updatedAt: new Date()
      }).where(and(eq(backgroundExperiences.agentId, agentId), inArray(backgroundExperiences.id, pendingIds)));
      return { attempted: pending.length, ready: 0, failed: pending.length };
    }
  }

  async backfill(options: { readonly agentId?: string; readonly limit?: number; readonly signal?: AbortSignal } = {}): Promise<BackgroundExperienceEmbeddingResult> {
    const owner = options.agentId === undefined ? undefined : eq(backgroundExperiences.agentId, options.agentId);
    const pending = await this.database.db.select({
      id: backgroundExperiences.id, agentId: backgroundExperiences.agentId
    }).from(backgroundExperiences).where(and(
      owner,
      or(isNull(backgroundExperiences.embedding), inArray(backgroundExperiences.embeddingStatus, ["pending", "failed"]))
    )).orderBy(asc(backgroundExperiences.occurredAt), asc(backgroundExperiences.id)).limit(options.limit ?? 100);
    let attempted = 0; let ready = 0; let failed = 0;
    const byAgent = new Map<string, string[]>();
    for (const row of pending) byAgent.set(row.agentId, [...(byAgent.get(row.agentId) ?? []), row.id]);
    for (const [agentId, ids] of byAgent) {
      const result = await this.embedIds(agentId, ids, options.signal);
      attempted += result.attempted; ready += result.ready; failed += result.failed;
    }
    return { attempted, ready, failed };
  }
}
