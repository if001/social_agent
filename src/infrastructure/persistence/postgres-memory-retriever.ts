import type { Pool, QueryResultRow } from "pg";

import type { Memory } from "../../domain/contracts.js";
import type { MemoryRepository } from "../../application/ports.js";

type MemoryRow = QueryResultRow & { id: string; agent_id: string; kind: Memory["kind"]; content: string; importance: string; occurred_at: Date; source_agent_id: string | null; evidence_event_ids: string[]; score: number };
export type RetrievalFilter = { readonly kinds?: readonly Memory["kind"][]; readonly occurredAfter?: Date };

export class PostgresMemoryRetriever implements MemoryRepository {
  constructor(private readonly pool: Pool) {}
  async save(memory: Memory): Promise<void> {
    await this.pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,source_agent_id,evidence_event_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [memory.id, memory.agentId, memory.kind, memory.content, memory.importance, memory.createdAt, memory.sourceAgentId ?? null, JSON.stringify(memory.evidenceEventIds)]);
  }
  async list(agentId: string): Promise<readonly Memory[]> { return this.retrieve(agentId, "", [], 100); }
  async retrieve(agentId: string, query: string, embedding: readonly number[], limit: number, filter: RetrievalFilter = {}): Promise<readonly Memory[]> {
    const vectorValue = embedding.length > 0 ? `[${embedding.join(",")}]` : null;
    const result = await this.pool.query<MemoryRow>(`SELECT m.*, (CASE WHEN $2 = '' THEN 0 ELSE ts_rank(to_tsvector('simple',m.content), plainto_tsquery('simple',$2)) END + CASE WHEN $3::text IS NULL OR m.embedding IS NULL THEN 0 ELSE 1 - (m.embedding <=> $3::vector) END) AS score FROM memories m WHERE m.agent_id=$1 AND ($4::text[] IS NULL OR m.kind=ANY($4)) AND ($5::timestamptz IS NULL OR m.occurred_at >= $5) ORDER BY score DESC, m.occurred_at DESC, m.id ASC LIMIT $6`, [agentId, query, vectorValue, filter.kinds ?? null, filter.occurredAfter ?? null, limit]);
    return result.rows.map((row) => ({ id: row.id, agentId: row.agent_id, kind: row.kind, content: row.content, createdAt: row.occurred_at.toISOString(), relatedSubjectIds: [], relatedIntentionIds: [], importance: row.importance, ...(row.source_agent_id === null ? {} : { sourceAgentId: row.source_agent_id }), evidenceEventIds: row.evidence_event_ids }));
  }
}
