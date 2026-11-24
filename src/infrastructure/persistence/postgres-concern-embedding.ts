import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";

import type { MemoryEmbeddingPreparer } from "../../application/ports.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { concerns } from "./schema.js";

export type ConcernEmbeddingResult = { readonly attempted: number; readonly ready: number; readonly failed: number };

/** Keeps the retrieval-only Concern index derived from its canonical text. */
export class PostgresConcernEmbeddingLifecycle {
  constructor(private readonly database: RuntimeDatabase, private readonly embeddings: MemoryEmbeddingPreparer) {}
  async embedConcernIds(agentId: string, ids: readonly string[]): Promise<ConcernEmbeddingResult> {
    const unique = [...new Set(ids)];
    if (unique.length === 0) return { attempted: 0, ready: 0, failed: 0 };
    const rows = await this.database.db.select({ id: concerns.id, description: concerns.description, whyItMatters: concerns.whyItMatters }).from(concerns).where(and(eq(concerns.agentId, agentId), inArray(concerns.id, unique), or(isNull(concerns.embedding), ne(concerns.embeddingStatus, "ready"))));
    let ready = 0;
    for (const row of rows) {
      const at = new Date(); const value = await this.embeddings.prepareMemory(`${row.description}\n${row.whyItMatters}`);
      if (value.status === "ready") ready += 1;
      await this.database.db.update(concerns).set({ embedding: value.vector === undefined ? null : [...value.vector], embeddingModel: value.model ?? null, embeddingDimension: value.dimension ?? null, embeddingStatus: value.status, embeddingError: value.error ?? null, embeddingLastAttemptAt: at, updatedAt: at }).where(and(eq(concerns.id, row.id), eq(concerns.agentId, agentId)));
    }
    return { attempted: rows.length, ready, failed: rows.length - ready };
  }

  async backfill(options: { readonly agentId?: string; readonly limit?: number } = {}): Promise<ConcernEmbeddingResult> {
    const owner = options.agentId === undefined ? undefined : eq(concerns.agentId, options.agentId);
    const pending = await this.database.db.select({ id: concerns.id, agentId: concerns.agentId }).from(concerns).where(and(owner, isNull(concerns.deletedAt), or(isNull(concerns.embedding), inArray(concerns.embeddingStatus, ["pending", "failed"])))).orderBy(asc(concerns.createdAt), asc(concerns.id)).limit(options.limit ?? 100);
    const byAgent = new Map<string, string[]>();
    for (const row of pending) byAgent.set(row.agentId, [...(byAgent.get(row.agentId) ?? []), row.id]);
    let attempted = 0; let ready = 0; let failed = 0;
    for (const [agentId, ids] of byAgent) {
      const result = await this.embedConcernIds(agentId, ids);
      attempted += result.attempted; ready += result.ready; failed += result.failed;
    }
    return { attempted, ready, failed };
  }
}
