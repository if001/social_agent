import type { Pool, QueryResultRow } from "pg";

import type { RelevantMemoryQuery } from "../../application/memory-query.js";
import type { MemoryRepository } from "../../application/ports.js";
import type { Memory, MemoryRetrievalTrace } from "../../domain/contracts.js";

type MemoryRow = QueryResultRow & {
  id: string; agent_id: string; kind: Memory["kind"]; content: string; importance: string; retrieval_priority: Memory["retrievalPriority"];
  occurred_at: Date; created_at: Date; source_agent_id: string | null; evidence_event_ids: string[];
  vector_rank: string | null; keyword_rank: string | null; subject_rank: string | null; recency_rank: string;
};
export type RetrievalFilter = { readonly occurredAfter?: Date };
export type MemoryRetrievalResult = { readonly memories: readonly Memory[]; readonly trace: readonly MemoryRetrievalTrace[] };

const rank = (value: string | null): number | undefined => value === null ? undefined : Number(value);

export class PostgresMemoryRetriever implements MemoryRepository {
  constructor(private readonly pool: Pool) {}
  async save(memory: Memory): Promise<void> {
    await this.pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,retrieval_priority,occurred_at,created_at,source_agent_id,evidence_event_ids,embedding_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')", [memory.id, memory.agentId, memory.kind, memory.content, memory.importance, memory.retrievalPriority, memory.occurredAt, memory.createdAt, memory.sourceAgentId ?? null, JSON.stringify(memory.evidenceEventIds)]);
  }
  async list(agentId: string): Promise<readonly Memory[]> { return (await this.retrieve(agentId, { text: "", keywords: [], subjectIds: [], kinds: ["episodic", "semantic", "self-related"] }, [], 100)).memories; }
  async retrieve(agentId: string, query: RelevantMemoryQuery, embedding: readonly number[], limit: number, filter: RetrievalFilter = {}): Promise<MemoryRetrievalResult> {
    if (limit <= 0) return { memories: [], trace: [] };
    const vectorValue = embedding.length > 0 ? `[${embedding.join(",")}]` : null;
    const candidateLimit = Math.max(limit * 4, 24);
    const result = await this.pool.query<MemoryRow>(`WITH base AS (
      SELECT m.*,
        CASE WHEN $2::text IS NULL OR m.embedding IS NULL OR m.embedding_status<>'ready' THEN NULL ELSE 1-(m.embedding <=> $2::vector) END AS vector_similarity,
        (SELECT count(*)::int FROM unnest($3::text[]) keyword WHERE length(keyword)>=2 AND position(keyword in lower(m.content))>0) AS keyword_hits,
        (SELECT count(*)::int FROM memory_subjects ms WHERE ms.memory_id=m.id AND ms.subject_id=ANY($4::text[])) AS subject_hits
      FROM memories m WHERE m.agent_id=$1 AND m.kind=ANY($5::text[]) AND ($6::timestamptz IS NULL OR m.occurred_at >= $6)
    ), ranked AS (
      SELECT base.*,
        CASE WHEN vector_similarity IS NULL THEN NULL ELSE row_number() OVER (ORDER BY vector_similarity DESC NULLS LAST,occurred_at DESC,id) END AS vector_rank,
        CASE WHEN keyword_hits=0 THEN NULL ELSE row_number() OVER (ORDER BY keyword_hits DESC,occurred_at DESC,id) END AS keyword_rank,
        CASE WHEN subject_hits=0 THEN NULL ELSE row_number() OVER (ORDER BY subject_hits DESC,occurred_at DESC,id) END AS subject_rank,
        row_number() OVER (ORDER BY occurred_at DESC,id) AS recency_rank FROM base
    ) SELECT ranked.* FROM ranked ORDER BY
      COALESCE(1.0/(60+vector_rank),0)+COALESCE(1.0/(60+keyword_rank),0)+COALESCE(1.0/(60+subject_rank),0)+0.25/(60+recency_rank)+
      CASE retrieval_priority WHEN 'critical' THEN 0.012 WHEN 'high' THEN 0.006 WHEN 'low' THEN -0.002 ELSE 0 END DESC,
      occurred_at DESC,id ASC LIMIT $7`, [agentId, vectorValue, query.keywords.map((value) => value.toLocaleLowerCase("ja")), query.subjectIds, query.kinds, filter.occurredAfter ?? null, candidateLimit]);
    const ranked = result.rows.map((row, index) => {
      const matchedBy: MemoryRetrievalTrace["matchedBy"] = [];
      if (rank(row.vector_rank) !== undefined) matchedBy.push("vector");
      if (rank(row.keyword_rank) !== undefined) matchedBy.push("keyword");
      if (rank(row.subject_rank) !== undefined) matchedBy.push("subject");
      matchedBy.push("recency");
      const memory: Memory = { id: row.id, agentId: row.agent_id, kind: row.kind, content: row.content, occurredAt: row.occurred_at.toISOString(), createdAt: row.created_at.toISOString(), relatedSubjectIds: [], importance: row.importance, retrievalPriority: row.retrieval_priority, ...(row.source_agent_id === null ? {} : { sourceAgentId: row.source_agent_id }), evidenceEventIds: row.evidence_event_ids };
      return { memory, matchedBy, finalRank: index + 1 };
    });
    const selectedIds = new Set<string>();
    for (const kind of ["episodic", "semantic", "self-related"] as const) {
      const candidate = ranked.find(({ memory, matchedBy }) => memory.kind === kind && matchedBy.some((signal) => signal !== "recency"));
      if (candidate !== undefined && selectedIds.size < limit) selectedIds.add(candidate.memory.id);
    }
    for (const candidate of ranked) if (selectedIds.size < limit) selectedIds.add(candidate.memory.id);
    const memories = ranked.filter(({ memory }) => selectedIds.has(memory.id)).map(({ memory }) => memory);
    const trace = ranked.map(({ memory, matchedBy, finalRank }): MemoryRetrievalTrace => ({ memoryId: memory.id, finalRank, matchedBy, kind: memory.kind, selected: selectedIds.has(memory.id), ...(selectedIds.has(memory.id) ? {} : { exclusionReason: finalRank <= limit ? "category-diversity" : "rank-limit" }) }));
    return { memories, trace };
  }
}
