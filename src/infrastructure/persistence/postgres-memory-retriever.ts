import type { Pool, QueryResultRow } from "pg";

import type { RelevantMemoryQuery } from "../../application/memory-query.js";
import type { MemoryRepository } from "../../application/ports.js";
import type { Memory, MemoryRetrievalTrace, RetrievalSignal } from "../../domain/contracts.js";
import { PostgresRetrievalService } from "./postgres-retrieval-service.js";

type MemoryRow = QueryResultRow & {
  id: string; agent_id: string; kind: Memory["kind"]; content: string; importance: string; retrieval_priority: Memory["retrievalPriority"];
  occurred_at: Date; created_at: Date; source_agent_id: string | null; evidence_event_ids: string[];
};
export type RetrievalFilter = { readonly occurredAfter?: Date };
export type MemoryRetrievalResult = { readonly memories: readonly Memory[]; readonly trace: readonly MemoryRetrievalTrace[] };

export class PostgresMemoryRetriever implements MemoryRepository {
  private readonly service: PostgresRetrievalService;
  constructor(private readonly pool: Pool) { this.service = new PostgresRetrievalService(pool); }
  async save(memory: Memory): Promise<void> {
    await this.pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,retrieval_priority,occurred_at,created_at,source_agent_id,evidence_event_ids,embedding_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')", [memory.id, memory.agentId, memory.kind, memory.content, memory.importance, memory.retrievalPriority, memory.occurredAt, memory.createdAt, memory.sourceAgentId ?? null, JSON.stringify(memory.evidenceEventIds)]);
  }
  async list(agentId: string): Promise<readonly Memory[]> { return (await this.retrieve(agentId, { text: "", keywords: [], subjectIds: [], kinds: ["episodic", "semantic", "self-related", "self-change", "common-ground"] }, [], 100)).memories; }
  async retrieve(agentId: string, query: RelevantMemoryQuery, embedding: readonly number[], limit: number, filter: RetrievalFilter = {}): Promise<MemoryRetrievalResult> {
    if (limit <= 0) return { memories: [], trace: [] };
    const candidates = await this.service.retrieve({
      agentId,
      query: query.text,
      keywords: query.keywords,
      embedding,
      scope: "conversation",
      kinds: query.kinds,
      subjectIds: query.subjectIds,
      ...(filter.occurredAfter === undefined ? {} : { occurredAfter: filter.occurredAfter.toISOString() }),
      limit: Math.max(limit * 4, 24)
    });
    if (candidates.length === 0) return { memories: [], trace: [] };
    const rows = await this.pool.query<MemoryRow>(`SELECT id,agent_id,kind,content,importance,retrieval_priority,occurred_at,created_at,source_agent_id,evidence_event_ids
      FROM memories WHERE agent_id=$1 AND id=ANY($2::text[])`, [agentId, candidates.map(({ id }) => id)]);
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    const ranked = candidates.flatMap((candidate) => {
      const row = byId.get(candidate.id);
      if (row === undefined) return [];
      const memory: Memory = { id: row.id, agentId: row.agent_id, kind: row.kind, content: row.content, occurredAt: row.occurred_at.toISOString(), createdAt: row.created_at.toISOString(), relatedSubjectIds: [], importance: row.importance, retrievalPriority: row.retrieval_priority, ...(row.source_agent_id === null ? {} : { sourceAgentId: row.source_agent_id }), evidenceEventIds: row.evidence_event_ids };
      const matchedBy: RetrievalSignal[] = candidate.matchedBy;
      return [{ memory, matchedBy, finalRank: candidate.finalRank }];
    });
    const selectedIds = new Set<string>();
    for (const kind of query.kinds) {
      const candidate = ranked.find(({ memory, matchedBy }) => memory.kind === kind && matchedBy.some((signal) => signal !== "recency"));
      if (candidate !== undefined && selectedIds.size < limit) selectedIds.add(candidate.memory.id);
    }
    for (const candidate of ranked) if (selectedIds.size < limit) selectedIds.add(candidate.memory.id);
    const memories = ranked.filter(({ memory }) => selectedIds.has(memory.id)).map(({ memory }) => memory);
    const trace = ranked.map(({ memory, matchedBy, finalRank }): MemoryRetrievalTrace => ({ memoryId: memory.id, finalRank, matchedBy, kind: memory.kind, selected: selectedIds.has(memory.id), ...(selectedIds.has(memory.id) ? {} : { exclusionReason: finalRank <= limit ? "category-diversity" : "rank-limit" }) }));
    return { memories, trace };
  }
}
