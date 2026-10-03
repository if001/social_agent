import type { Pool, QueryResultRow } from "pg";

import type { LongTermReviewRepository, ReviewCommit } from "../../application/long-term-review.js";
import { DomainError, type Candidate, type Memory } from "../../domain/contracts.js";
import type { MemoryEmbeddingLifecycle } from "./postgres-memory-embedding.js";

type CandidateRow = QueryResultRow & { id: string; agent_id: string; target: Candidate["target"]; proposed_value: string; reason: string; status: Candidate["status"]; created_at: Date; evidence_ids: string[]; evidence_event_ids: string[] };
type MemoryRow = QueryResultRow & { id: string; agent_id: string; kind: Memory["kind"]; content: string; importance: string; occurred_at: Date; source_agent_id: string | null; evidence_event_ids: string[] };

export class PostgresLongTermReviewRepository implements LongTermReviewRepository {
  constructor(private readonly pool: Pool, private readonly nextId: () => string, private readonly memoryEmbedding?: MemoryEmbeddingLifecycle) {}
  async loadCandidates(candidateIds: readonly string[]): Promise<readonly Candidate[]> {
    const result = await this.pool.query<CandidateRow>("SELECT c.*,COALESCE(json_agg(e.memory_id) FILTER (WHERE e.memory_id IS NOT NULL),'[]') AS evidence_ids FROM long_term_candidates c LEFT JOIN candidate_evidence e ON e.candidate_id=c.id WHERE c.id=ANY($1::text[]) GROUP BY c.id ORDER BY c.id", [candidateIds]);
    return result.rows.map((row) => ({ id: row.id, agentId: row.agent_id, target: row.target, proposal: row.proposed_value, reason: row.reason, evidenceMemoryIds: row.evidence_ids, evidenceEventIds: row.evidence_event_ids, status: row.status, createdAt: row.created_at.toISOString() }));
  }
  async loadEvidence(candidateIds: readonly string[]): Promise<readonly Memory[]> {
    const result = await this.pool.query<MemoryRow>("SELECT DISTINCT m.* FROM memories m JOIN candidate_evidence e ON e.memory_id=m.id WHERE e.candidate_id=ANY($1::text[]) ORDER BY m.id", [candidateIds]);
    return result.rows.map((row) => ({ id: row.id, agentId: row.agent_id, kind: row.kind, content: row.content, createdAt: row.occurred_at.toISOString(), relatedSubjectIds: [], relatedIntentionIds: [], importance: row.importance, ...(row.source_agent_id === null ? {} : { sourceAgentId: row.source_agent_id }), evidenceEventIds: row.evidence_event_ids }));
  }
  async loadCurrentValue(agentId: string, target: Candidate["target"]): Promise<string> {
    const column = target === "selfNarrative" ? "self_narrative" : "acquired_disposition";
    const result = await this.pool.query<{ value: string }>(`SELECT ${column} AS value FROM agent_states WHERE agent_id=$1`, [agentId]);
    const value = result.rows[0]?.value; if (value === undefined) throw new DomainError("NOT_FOUND", "Agent state not found"); return value;
  }
  async commit(review: ReviewCommit): Promise<void> {
    const client = await this.pool.connect();
    let selfChangeMemoryId: string | undefined;
    try {
      await client.query("BEGIN");
      const ids = review.candidateDecisions.map(({ candidateId }) => candidateId);
      const locked = await client.query<{ id: string; status: string }>("SELECT id,status FROM long_term_candidates WHERE id=ANY($1::text[]) AND agent_id=$2 FOR UPDATE", [ids, review.agentId]);
      if (locked.rowCount !== ids.length || locked.rows.some(({ status }) => status !== "pending")) throw new DomainError("CONFLICT", "Candidate was already reviewed or does not belong to the Agent");
      if (review.after !== undefined) {
        const column = review.target === "selfNarrative" ? "self_narrative" : "acquired_disposition";
        await client.query(`UPDATE agent_states SET ${column}=$2,version=version+1,updated_at=now() WHERE agent_id=$1`, [review.agentId, review.after]);
        selfChangeMemoryId = this.nextId();
        await client.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,evidence_event_ids,embedding_status) VALUES ($1,$2,'self-change',$3,$4,now(),$5,'pending')", [selfChangeMemoryId, review.agentId, `Changed ${review.target} from: ${review.before}\nTo: ${review.after}`, review.reason, JSON.stringify(review.evidenceMemoryIds)]);
      }
      for (const decision of review.candidateDecisions) await client.query("UPDATE long_term_candidates SET status=$2,updated_at=now() WHERE id=$1", [decision.candidateId, decision.status]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    if (selfChangeMemoryId !== undefined) await this.memoryEmbedding?.embedMemoryIds(review.agentId, [selfChangeMemoryId]);
  }
}
