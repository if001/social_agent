import type { Pool, QueryResultRow } from "pg";

import type { Candidate, Memory } from "../../domain/contracts.js";
import type { LongTermReviewRepository, ReviewCommit } from "../../application/long-term-review.js";
import { DomainError } from "../../domain/contracts.js";
import { PostgresUnitOfWork } from "./postgres.js";

type CandidateRow = QueryResultRow & { id: string; agent_id: string; target: Candidate["target"]; proposed_value: string; status: Candidate["status"]; reason: string; created_at: Date; evidence_ids: string[] };
type MemoryRow = QueryResultRow & { id: string; agent_id: string; kind: Memory["kind"]; content: string; importance: string; occurred_at: Date; source_agent_id: string | null; evidence_event_ids: string[] };

export class PostgresLongTermReviewRepository implements LongTermReviewRepository {
  readonly #unit: PostgresUnitOfWork;
  constructor(private readonly pool: Pool, private readonly nextId: () => string) { this.#unit = new PostgresUnitOfWork(pool); }
  async loadCandidate(candidateId: string): Promise<Candidate | undefined> {
    const result = await this.pool.query<CandidateRow>("SELECT c.*,COALESCE(json_agg(e.memory_id) FILTER (WHERE e.memory_id IS NOT NULL),'[]') AS evidence_ids FROM long_term_candidates c LEFT JOIN candidate_evidence e ON e.candidate_id=c.id WHERE c.id=$1 GROUP BY c.id", [candidateId]); const row = result.rows[0];
    return row === undefined ? undefined : { id: row.id, agentId: row.agent_id, target: row.target, proposal: row.proposed_value, reason: row.reason, evidenceMemoryIds: row.evidence_ids, status: row.status, createdAt: row.created_at.toISOString() };
  }
  async loadEvidence(candidateId: string): Promise<readonly Memory[]> {
    const result = await this.pool.query<MemoryRow>("SELECT m.* FROM memories m JOIN candidate_evidence e ON e.memory_id=m.id WHERE e.candidate_id=$1 ORDER BY m.id", [candidateId]);
    return result.rows.map((row) => ({ id: row.id, agentId: row.agent_id, kind: row.kind, content: row.content, createdAt: row.occurred_at.toISOString(), relatedSubjectIds: [], relatedIntentionIds: [], importance: row.importance, ...(row.source_agent_id === null ? {} : { sourceAgentId: row.source_agent_id }), evidenceEventIds: row.evidence_event_ids }));
  }
  async loadCurrentValue(agentId: string, target: Candidate["target"]): Promise<string> {
    const column = target === "selfNarrative" ? "self_narrative" : "acquired_disposition"; const result = await this.pool.query<{ value: string }>(`SELECT ${column} AS value FROM agent_states WHERE agent_id=$1`, [agentId]);
    const value = result.rows[0]?.value; if (value === undefined) throw new DomainError("NOT_FOUND", "Agent state not found"); return value;
  }
  async commit(review: ReviewCommit): Promise<void> {
    await this.#unit.transaction(async (client) => {
      const locked = await client.query<{ status: string }>("SELECT status FROM long_term_candidates WHERE id=$1 AND agent_id=$2 FOR UPDATE", [review.candidateId, review.agentId]);
      if (locked.rows[0]?.status !== "pending") throw new DomainError("CONFLICT", "Candidate was already reviewed");
      if (review.after !== undefined) {
        const column = review.target === "selfNarrative" ? "self_narrative" : "acquired_disposition";
        await client.query(`UPDATE agent_states SET ${column}=$2,version=version+1,updated_at=now() WHERE agent_id=$1`, [review.agentId, review.after]);
        await client.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,evidence_event_ids) VALUES ($1,$2,'self-change',$3,$4,now(),$5)", [this.nextId(), review.agentId, `Changed ${review.target} from: ${review.before}\nTo: ${review.after}`, review.reason, JSON.stringify(review.evidenceMemoryIds)]);
      }
      await client.query("UPDATE long_term_candidates SET status=$2,updated_at=now() WHERE id=$1", [review.candidateId, review.status]);
    });
  }
}
