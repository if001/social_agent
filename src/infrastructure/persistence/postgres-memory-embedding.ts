import type { Pool, QueryResultRow } from "pg";

import type { EmbeddingProvider } from "../../application/ports.js";

type MemoryRow = QueryResultRow & { id: string; agent_id: string; content: string };

export type MemoryEmbeddingResult = {
  readonly attempted: number;
  readonly ready: number;
  readonly failed: number;
};

export interface MemoryEmbeddingLifecycle {
  embedMemoryIds(agentId: string, memoryIds: readonly string[], signal?: AbortSignal): Promise<MemoryEmbeddingResult>;
}

export class PostgresMemoryEmbeddingLifecycle implements MemoryEmbeddingLifecycle {
  constructor(
    private readonly pool: Pool,
    private readonly provider: EmbeddingProvider,
    private readonly model: string
  ) {}

  async embedMemoryIds(agentId: string, memoryIds: readonly string[], signal: AbortSignal = new AbortController().signal): Promise<MemoryEmbeddingResult> {
    if (memoryIds.length === 0) return { attempted: 0, ready: 0, failed: 0 };
    const pending = await this.pool.query<MemoryRow>(
      "SELECT id,agent_id,content FROM memories WHERE agent_id=$1 AND id=ANY($2::text[]) AND (embedding IS NULL OR embedding_status<>'ready') ORDER BY id",
      [agentId, [...new Set(memoryIds)]]
    );
    if (pending.rows.length === 0) return { attempted: 0, ready: 0, failed: 0 };
    const ids = pending.rows.map(({ id }) => id);
    await this.pool.query("UPDATE memories SET embedding_last_attempt_at=now(),embedding_error=NULL,updated_at=now() WHERE agent_id=$1 AND id=ANY($2::text[])", [agentId, ids]);
    try {
      const vectors = await this.provider.embed(pending.rows.map(({ content }) => content), signal);
      for (let index = 0; index < pending.rows.length; index += 1) {
        const row = pending.rows[index]; const vector = vectors[index];
        if (row === undefined || vector === undefined || vector.length !== this.provider.dimension) throw new Error("Embedding provider returned an invalid vector batch");
        await this.pool.query(
          "UPDATE memories SET embedding=$3::vector,embedding_model=$4,embedding_dimension=$5,embedding_status='ready',embedding_error=NULL,updated_at=now() WHERE id=$1 AND agent_id=$2",
          [row.id, agentId, `[${vector.join(",")}]`, this.model, this.provider.dimension]
        );
      }
      return { attempted: pending.rows.length, ready: pending.rows.length, failed: 0 };
    } catch (error) {
      const message = (error instanceof Error ? error.message : "Embedding generation failed").slice(0, 2_000);
      await this.pool.query("UPDATE memories SET embedding=NULL,embedding_model=NULL,embedding_dimension=NULL,embedding_status='failed',embedding_error=$3,updated_at=now() WHERE agent_id=$1 AND id=ANY($2::text[])", [agentId, ids, message]);
      return { attempted: pending.rows.length, ready: 0, failed: pending.rows.length };
    }
  }

  async backfill(options: { readonly agentId?: string; readonly limit?: number; readonly signal?: AbortSignal } = {}): Promise<MemoryEmbeddingResult> {
    const limit = options.limit ?? 100;
    const pending = await this.pool.query<MemoryRow>(
      "SELECT id,agent_id,content FROM memories WHERE ($1::text IS NULL OR agent_id=$1) AND (embedding IS NULL OR embedding_status IN ('pending','failed')) ORDER BY created_at,id LIMIT $2",
      [options.agentId ?? null, limit]
    );
    let attempted = 0; let ready = 0; let failed = 0;
    const byAgent = new Map<string, string[]>();
    for (const row of pending.rows) byAgent.set(row.agent_id, [...(byAgent.get(row.agent_id) ?? []), row.id]);
    for (const [agentId, ids] of byAgent) {
      const result = await this.embedMemoryIds(agentId, ids, options.signal);
      attempted += result.attempted; ready += result.ready; failed += result.failed;
    }
    return { attempted, ready, failed };
  }
}
