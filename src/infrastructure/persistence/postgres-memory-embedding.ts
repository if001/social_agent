import { and, asc, eq, inArray, isNull, ne, or } from "drizzle-orm";

import type { EmbeddingProvider, MemoryEmbedding, MemoryEmbeddingPreparer } from "../../application/ports.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { memories } from "./schema.js";

export type MemoryEmbeddingResult = { readonly attempted: number; readonly ready: number; readonly failed: number };
export interface MemoryEmbeddingLifecycle {
  embedMemoryIds(agentId: string, memoryIds: readonly string[], signal?: AbortSignal): Promise<MemoryEmbeddingResult>;
}

export class PostgresMemoryEmbeddingLifecycle implements MemoryEmbeddingLifecycle, MemoryEmbeddingPreparer {
  constructor(private readonly database: RuntimeDatabase, private readonly provider: EmbeddingProvider, private readonly model: string) {}

  async prepareMemory(content: string, signal: AbortSignal = new AbortController().signal): Promise<MemoryEmbedding> {
    try {
      const [vector] = await this.provider.embed([content], signal);
      if (vector === undefined || vector.length !== this.provider.dimension) throw new Error("Embedding provider returned an invalid vector");
      return { status: "ready", vector, model: this.model, dimension: this.provider.dimension };
    } catch (error) {
      return { status: "failed", error: (error instanceof Error ? error.message : "Embedding generation failed").slice(0, 2_000) };
    }
  }

  async embedMemoryIds(agentId: string, memoryIds: readonly string[], signal: AbortSignal = new AbortController().signal): Promise<MemoryEmbeddingResult> {
    const uniqueIds = [...new Set(memoryIds)];
    if (uniqueIds.length === 0) return { attempted: 0, ready: 0, failed: 0 };
    const pending = await this.database.db.select({ id: memories.id, content: memories.content }).from(memories).where(and(
      eq(memories.agentId, agentId), inArray(memories.id, uniqueIds),
      or(isNull(memories.embedding), ne(memories.embeddingStatus, "ready"))
    )).orderBy(asc(memories.id));
    if (pending.length === 0) return { attempted: 0, ready: 0, failed: 0 };
    const ids = pending.map(({ id }) => id);
    const attemptedAt = new Date();
    await this.database.db.update(memories).set({
      embeddingLastAttemptAt: attemptedAt, embeddingError: null, updatedAt: attemptedAt
    }).where(and(eq(memories.agentId, agentId), inArray(memories.id, ids)));
    let ready = 0;
    for (const row of pending) {
      const embedding = await this.prepareMemory(row.content, signal);
      if (embedding.status === "ready") ready += 1;
      await this.database.db.update(memories).set({
        embedding: embedding.vector === undefined ? null : [...embedding.vector],
        embeddingModel: embedding.model ?? null,
        embeddingDimension: embedding.dimension ?? null,
        embeddingStatus: embedding.status,
        embeddingError: embedding.error ?? null,
        updatedAt: new Date()
      }).where(and(eq(memories.id, row.id), eq(memories.agentId, agentId)));
    }
    return { attempted: pending.length, ready, failed: pending.length - ready };
  }

  async backfill(options: { readonly agentId?: string; readonly limit?: number; readonly signal?: AbortSignal } = {}): Promise<MemoryEmbeddingResult> {
    const owner = options.agentId === undefined ? undefined : eq(memories.agentId, options.agentId);
    const pending = await this.database.db.select({
      id: memories.id, agentId: memories.agentId
    }).from(memories).where(and(
      owner,
      or(isNull(memories.embedding), inArray(memories.embeddingStatus, ["pending", "failed"]))
    )).orderBy(asc(memories.createdAt), asc(memories.id)).limit(options.limit ?? 100);
    let attempted = 0; let ready = 0; let failed = 0;
    const byAgent = new Map<string, string[]>();
    for (const row of pending) byAgent.set(row.agentId, [...(byAgent.get(row.agentId) ?? []), row.id]);
    for (const [agentId, ids] of byAgent) {
      const result = await this.embedMemoryIds(agentId, ids, options.signal);
      attempted += result.attempted; ready += result.ready; failed += result.failed;
    }
    return { attempted, ready, failed };
  }
}
