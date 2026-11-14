import type { Pool } from "pg";
import { and, eq, inArray } from "drizzle-orm";

import type { RelevantMemoryQuery } from "../../application/memory-query.js";
import type { MemoryRepository } from "../../application/ports.js";
import type { Memory, MemoryRetrievalTrace, RetrievalSignal } from "../../domain/contracts.js";
import { PostgresRetrievalService } from "./postgres-retrieval-service.js";
import { createRuntimeDatabase, type RuntimeDatabase } from "./runtime-database.js";
import { memories } from "./schema.js";

export type RetrievalFilter = { readonly occurredAfter?: Date };
export type MemoryRetrievalResult = { readonly memories: readonly Memory[]; readonly trace: readonly MemoryRetrievalTrace[] };

export class PostgresMemoryRetriever implements MemoryRepository {
  private readonly service: PostgresRetrievalService;
  private readonly database: RuntimeDatabase;
  constructor(pool: Pool) { this.database = createRuntimeDatabase(pool); this.service = new PostgresRetrievalService(pool); }
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
    const rows = await this.database.db.select({ id: memories.id, agentId: memories.agentId, kind: memories.kind, content: memories.content, importance: memories.importance, retrievalPriority: memories.retrievalPriority, occurredAt: memories.occurredAt, createdAt: memories.createdAt, sourceAgentId: memories.sourceAgentId, evidenceEventIds: memories.evidenceEventIds }).from(memories).where(and(eq(memories.agentId, agentId), inArray(memories.id, candidates.map(({ id }) => id))));
    const byId = new Map(rows.map((row) => [row.id, row]));
    const ranked = candidates.flatMap((candidate) => {
      const row = byId.get(candidate.id);
      if (row === undefined) return [];
      const memory: Memory = { id: row.id, agentId: row.agentId, kind: row.kind as Memory["kind"], content: row.content, occurredAt: row.occurredAt.toISOString(), createdAt: row.createdAt.toISOString(), relatedSubjectIds: [], importance: row.importance, retrievalPriority: row.retrievalPriority as Memory["retrievalPriority"], ...(row.sourceAgentId === null ? {} : { sourceAgentId: row.sourceAgentId }), evidenceEventIds: row.evidenceEventIds as string[] };
      const matchedBy: RetrievalSignal[] = candidate.matchedBy;
      return [{ memory, matchedBy, finalRank: candidate.finalRank }];
    });
    const selectedIds = new Set<string>();
    for (const kind of query.kinds) {
      const candidate = ranked.find(({ memory, matchedBy }) => memory.kind === kind && matchedBy.some((signal) => signal !== "recency"));
      if (candidate !== undefined && selectedIds.size < limit) selectedIds.add(candidate.memory.id);
    }
    for (const candidate of ranked) if (selectedIds.size < limit) selectedIds.add(candidate.memory.id);
    const selectedMemories = ranked.filter(({ memory }) => selectedIds.has(memory.id)).map(({ memory }) => memory);
    const trace = ranked.map(({ memory, matchedBy, finalRank }): MemoryRetrievalTrace => ({ memoryId: memory.id, finalRank, matchedBy, kind: memory.kind, selected: selectedIds.has(memory.id), ...(selectedIds.has(memory.id) ? {} : { exclusionReason: finalRank <= limit ? "category-diversity" : "rank-limit" }) }));
    return { memories: selectedMemories, trace };
  }
}
