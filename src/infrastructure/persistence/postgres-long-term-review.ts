import type { Pool, QueryResultRow } from "pg";

import type { LongTermReviewRepository, ReviewCommit, ReviewEvidence, ReviewValue } from "../../application/long-term-review.js";
import { DomainError, ObservationSchema, type Candidate, type Memory } from "../../domain/contracts.js";
import type { MemoryEmbeddingLifecycle } from "./postgres-memory-embedding.js";

type CandidateRow = QueryResultRow & { id: string; agent_id: string; target: Candidate["target"]; proposed_value: string; reason: string; status: Candidate["status"]; created_at: Date; evidence_ids: string[]; evidence_event_ids: string[] };
type MemoryRow = QueryResultRow & { id: string; agent_id: string; kind: Memory["kind"]; content: string; importance: string; retrieval_priority: Memory["retrievalPriority"]; occurred_at: Date; created_at: Date; source_agent_id: string | null; evidence_event_ids: string[] };
type EventRow = QueryResultRow & { id: string; observation: unknown };
const formatReviewValue = (value: ReviewValue): string => Array.isArray(value) ? JSON.stringify(value) : value;

export class PostgresLongTermReviewRepository implements LongTermReviewRepository {
  constructor(private readonly pool: Pool, private readonly nextId: () => string, private readonly memoryEmbedding?: MemoryEmbeddingLifecycle) {}
  async loadCandidates(candidateIds: readonly string[]): Promise<readonly Candidate[]> {
    const result = await this.pool.query<CandidateRow>("SELECT c.*,COALESCE(json_agg(e.memory_id) FILTER (WHERE e.memory_id IS NOT NULL),'[]') AS evidence_ids FROM long_term_candidates c LEFT JOIN candidate_evidence e ON e.candidate_id=c.id WHERE c.id=ANY($1::text[]) GROUP BY c.id ORDER BY c.id", [candidateIds]);
    return result.rows.map((row) => ({ id: row.id, agentId: row.agent_id, target: row.target, proposal: row.proposed_value, reason: row.reason, evidenceMemoryIds: row.evidence_ids, evidenceEventIds: row.evidence_event_ids, status: row.status, createdAt: row.created_at.toISOString() }));
  }
  async loadEvidence(candidateIds: readonly string[], agentId: string): Promise<ReviewEvidence> {
    const [memoryResult, eventResult] = await Promise.all([
      this.pool.query<MemoryRow>("SELECT DISTINCT m.* FROM memories m JOIN candidate_evidence e ON e.memory_id=m.id WHERE e.candidate_id=ANY($1::text[]) AND m.agent_id=$2 ORDER BY m.id", [candidateIds, agentId]),
      this.pool.query<EventRow>("SELECT DISTINCT e.id,e.observation FROM long_term_candidates c CROSS JOIN LATERAL jsonb_array_elements_text(c.evidence_event_ids) evidence_id JOIN events e ON e.id=evidence_id AND e.agent_id=c.agent_id WHERE c.id=ANY($1::text[]) AND c.agent_id=$2 ORDER BY e.id", [candidateIds, agentId])
    ]);
    return {
      memories: memoryResult.rows.map((row) => ({ id: row.id, agentId: row.agent_id, kind: row.kind, content: row.content, occurredAt: row.occurred_at.toISOString(), createdAt: row.created_at.toISOString(), relatedSubjectIds: [], importance: row.importance, retrievalPriority: row.retrieval_priority, ...(row.source_agent_id === null ? {} : { sourceAgentId: row.source_agent_id }), evidenceEventIds: row.evidence_event_ids })),
      events: eventResult.rows.map(({ observation }) => ObservationSchema.parse(observation))
    };
  }
  async loadCurrentValue(agentId: string, target: Candidate["target"]): Promise<ReviewValue> {
    if (target === "semanticMemory" || target === "selfRelatedMemory") {
      const kind = target === "semanticMemory" ? "semantic" : "self-related";
      const result = await this.pool.query<{ value: string }>("SELECT COALESCE(string_agg(content,E'\\n' ORDER BY occurred_at,id),'(none)') AS value FROM memories WHERE agent_id=$1 AND kind=$2", [agentId, kind]);
      return result.rows[0]?.value ?? "(none)";
    }
    const column = ({ selfNarrative: "self_narrative", selfContinuity: "self_continuity", values: "values", acquiredDisposition: "acquired_disposition", role: "roles", raisonDetre: "raison_detre", longTermPreference: "preferences", longTermInterest: "interests" } as const)[target];
    const listTarget = target === "role" || target === "longTermPreference" || target === "longTermInterest";
    const result = await this.pool.query<{ value: unknown }>(`SELECT ${listTarget ? `COALESCE(${column},'[]'::jsonb)` : `COALESCE(${column},'(none)')`} AS value FROM agent_states WHERE agent_id=$1`, [agentId]);
    const value = result.rows[0]?.value;
    if (value === undefined) throw new DomainError("NOT_FOUND", "Agent state not found");
    if (listTarget && Array.isArray(value) && value.every((item): item is string => typeof item === "string" && item.trim() !== "")) return value;
    if (!listTarget && typeof value === "string" && value.trim() !== "") return value;
    throw new DomainError("VALIDATION", "Stored long-term value has an invalid shape");
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
        if (review.target === "semanticMemory" || review.target === "selfRelatedMemory") {
          selfChangeMemoryId = this.nextId();
          const kind = review.target === "semanticMemory" ? "semantic" : "self-related";
          await client.query("INSERT INTO memories(id,agent_id,kind,content,importance,retrieval_priority,occurred_at,evidence_event_ids,evidence_memory_ids,embedding_status) VALUES ($1,$2,$3,$4,$5,'high',now(),$6,$7,'pending')", [selfChangeMemoryId, review.agentId, kind, review.after, review.reason, JSON.stringify(review.evidenceEventIds), JSON.stringify(review.evidenceMemoryIds)]);
        } else {
          const column = ({ selfNarrative: "self_narrative", selfContinuity: "self_continuity", values: "values", acquiredDisposition: "acquired_disposition", role: "roles", raisonDetre: "raison_detre", longTermPreference: "preferences", longTermInterest: "interests" } as const)[review.target];
          const listTarget = review.target === "role" || review.target === "longTermPreference" || review.target === "longTermInterest";
          if (listTarget) await client.query(`UPDATE agent_states SET ${column}=$2::jsonb,version=version+1,updated_at=now() WHERE agent_id=$1`, [review.agentId, JSON.stringify(review.after)]);
          else await client.query(`UPDATE agent_states SET ${column}=$2,version=version+1,updated_at=now() WHERE agent_id=$1`, [review.agentId, review.after]);
          selfChangeMemoryId = this.nextId();
          await client.query("INSERT INTO memories(id,agent_id,kind,content,importance,retrieval_priority,occurred_at,evidence_event_ids,evidence_memory_ids,embedding_status) VALUES ($1,$2,'self-change',$3,$4,'normal',now(),$5,$6,'pending')", [selfChangeMemoryId, review.agentId, `Changed ${review.target} from: ${formatReviewValue(review.before)}\nTo: ${formatReviewValue(review.after)}`, review.reason, JSON.stringify(review.evidenceEventIds), JSON.stringify(review.evidenceMemoryIds)]);
        }
      }
      for (const decision of review.candidateDecisions) await client.query("UPDATE long_term_candidates SET status=$2,review_after=CASE WHEN $2='pending' THEN now()+interval '7 days' ELSE NULL END,review_lease_until=NULL,updated_at=now() WHERE id=$1", [decision.candidateId, decision.status]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    if (selfChangeMemoryId !== undefined) await this.memoryEmbedding?.embedMemoryIds(review.agentId, [selfChangeMemoryId]);
  }
}
