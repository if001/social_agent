import type { Pool, QueryResultRow } from "pg";

import type { IdGenerator } from "../../application/ports.js";
import { ReflectionInputSchema, ReflectionOutputSchema, type ReflectionInput, type ReflectionOutput, type ReflectionRepository } from "../../application/reflection.js";
import { AgentStateSchema, DomainError, EpisodicMemorySchema, SelfSchema, type Concern, type Relationship } from "../../domain/contracts.js";

type ReflectionRow = QueryResultRow & { status: string; input: unknown };
type StateRow = QueryResultRow & { identity: string; disposition: string; self_story: string; commitments: unknown; mood: string; concerns: unknown; relationships: unknown; version: number };
type EventRow = QueryResultRow & { id: string; occurred_at: Date; observation: unknown };
type MemoryRow = QueryResultRow & { id: string; content: string; importance: string; occurred_at: Date; created_at: Date; source_agent_id: string | null; subjects: unknown };

const summaryOf = (observation: unknown): string => {
  if (typeof observation === "object" && observation !== null && "summary" in observation && typeof observation.summary === "string" && observation.summary.trim() !== "") return observation.summary;
  return "記録された出来事";
};

function applyConcerns(current: readonly Concern[], changes: ReflectionOutput["concernChanges"]): Concern[] {
  const values = new Map(current.map((value) => [value.id, value]));
  for (const change of changes) if (change.operation === "remove") values.delete(change.id); else values.set(change.concern.id, change.concern);
  return [...values.values()];
}

function applyRelationships(current: readonly Relationship[], changes: ReflectionOutput["relationshipChanges"]): Relationship[] {
  const values = new Map(current.map((value) => [value.subjectId, value]));
  for (const change of changes) if (change.operation === "remove") values.delete(change.subjectId); else values.set(change.relationship.subjectId, change.relationship);
  return [...values.values()];
}

export class PostgresReflectionRepository implements ReflectionRepository {
  constructor(private readonly pool: Pool, private readonly ids: IdGenerator, private readonly now: () => Date) {}

  async load(reflectionId: string, agentId: string): Promise<ReflectionInput | undefined> {
    const existing = await this.pool.query<ReflectionRow>("SELECT status,input FROM reflection_runs WHERE id=$1 AND agent_id=$2", [reflectionId, agentId]);
    if (existing.rows[0] !== undefined) return ReflectionInputSchema.parse(existing.rows[0].input);
    const stateResult = await this.pool.query<StateRow>(`SELECT a.identity,s.disposition,s.self_story,s.commitments,s.mood,s.concerns,s.relationships,s.version
      FROM agents a JOIN agent_states s ON s.agent_id=a.id WHERE a.id=$1 AND a.active=true`, [agentId]);
    const row = stateResult.rows[0]; if (row === undefined) return undefined;
    const last = await this.pool.query<{ completed_at: Date | null }>("SELECT completed_at FROM reflection_runs WHERE agent_id=$1 AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1", [agentId]);
    const since = last.rows[0]?.completed_at ?? new Date(0);
    const [eventsResult, memoriesResult] = await Promise.all([
      this.pool.query<EventRow>("SELECT id,occurred_at,observation FROM events WHERE agent_id=$1 AND status='completed' AND kind<>'tool-result' AND occurred_at>$2 ORDER BY occurred_at,id LIMIT 32", [agentId, since]),
      this.pool.query<MemoryRow>(`SELECT m.id,m.content,m.importance,m.occurred_at,m.created_at,m.source_agent_id,
        COALESCE(jsonb_agg(ms.subject_id ORDER BY ms.subject_id) FILTER (WHERE ms.subject_id IS NOT NULL),'[]'::jsonb) AS subjects
        FROM memories m LEFT JOIN memory_subjects ms ON ms.memory_id=m.id WHERE m.agent_id=$1 GROUP BY m.id ORDER BY m.occurred_at DESC,m.id LIMIT 32`, [agentId])
    ]);
    if (eventsResult.rows.length === 0) return undefined;
    const input = ReflectionInputSchema.parse({
      reflectionId, agentId, expectedVersion: row.version,
      self: SelfSchema.parse({ identity: row.identity, disposition: row.disposition, selfStory: row.self_story, commitments: row.commitments }),
      state: AgentStateSchema.parse({ mood: row.mood, concerns: row.concerns, relationships: row.relationships }),
      events: eventsResult.rows.map((event) => ({ id: event.id, occurredAt: event.occurred_at.toISOString(), summary: summaryOf(event.observation) })),
      memories: memoriesResult.rows.map((memory) => EpisodicMemorySchema.parse({ id: memory.id, summary: memory.content, significance: memory.importance, subjects: memory.subjects, occurredAt: memory.occurred_at.toISOString(), createdAt: memory.created_at.toISOString(), ...(memory.source_agent_id === null ? {} : { source: memory.source_agent_id }) }))
    });
    await this.pool.query("INSERT INTO reflection_runs(id,agent_id,input_state_version,status,input) VALUES ($1,$2,$3,'pending',$4) ON CONFLICT (id) DO NOTHING", [reflectionId, agentId, input.expectedVersion, JSON.stringify(input)]);
    const stored = await this.pool.query<ReflectionRow>("SELECT status,input FROM reflection_runs WHERE id=$1 AND agent_id=$2", [reflectionId, agentId]);
    return stored.rows[0] === undefined ? undefined : ReflectionInputSchema.parse(stored.rows[0].input);
  }

  async commit(input: ReflectionInput, rawOutput: ReflectionOutput): Promise<"committed" | "duplicate"> {
    const output = ReflectionOutputSchema.parse(rawOutput); const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const run = await client.query<{ status: string }>("SELECT status FROM reflection_runs WHERE id=$1 AND agent_id=$2 FOR UPDATE", [input.reflectionId, input.agentId]);
      if (run.rows[0]?.status === "completed") { await client.query("COMMIT"); return "duplicate"; }
      if (run.rows[0] === undefined) throw new DomainError("NOT_FOUND", "Reflection run was not found");
      const state = AgentStateSchema.parse({ ...input.state, ...(output.mood === undefined ? {} : { mood: output.mood }), concerns: applyConcerns(input.state.concerns, output.concernChanges), relationships: applyRelationships(input.state.relationships, output.relationshipChanges) });
      const self = output.self ?? input.self;
      const updated = await client.query("UPDATE agent_states SET disposition=$3,self_story=$4,commitments=$5,concerns=$6,relationships=$7,mood=COALESCE($8,mood),version=version+1,updated_at=now() WHERE agent_id=$1 AND version=$2 RETURNING version", [input.agentId, input.expectedVersion, self.disposition, self.selfStory, JSON.stringify(self.commitments), JSON.stringify(state.concerns), JSON.stringify(state.relationships), state.mood ?? null]);
      if (updated.rowCount !== 1) throw new DomainError("CONFLICT", "Reflection state version conflict");
      if (self.identity !== input.self.identity) await client.query("UPDATE agents SET identity=$2,updated_at=now() WHERE id=$1", [input.agentId, self.identity]);
      for (const memory of output.memories) {
        const id = this.ids.next(); const createdAt = this.now();
        await client.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,created_at,source_agent_id,evidence_event_ids,embedding_status) VALUES ($1,$2,'episodic',$3,$4,$5,$6,$7,$8,'pending')", [id, input.agentId, memory.summary, memory.significance, memory.occurredAt, createdAt, memory.source ?? null, JSON.stringify(input.events.map(({ id: eventId }) => eventId))]);
        for (const subjectId of memory.subjects) await client.query("INSERT INTO memory_subjects(memory_id,subject_id) VALUES ($1,$2)", [id, subjectId]);
      }
      await client.query("UPDATE reflection_runs SET status='completed',output=$2,failure_reason=NULL,completed_at=now(),updated_at=now() WHERE id=$1", [input.reflectionId, JSON.stringify(output)]);
      await client.query("COMMIT"); return "committed";
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async fail(input: ReflectionInput, error: unknown): Promise<void> {
    await this.pool.query("UPDATE reflection_runs SET status='failed',failure_reason=$2,updated_at=now() WHERE id=$1 AND status<>'completed'", [input.reflectionId, error instanceof Error ? error.message : "Reflection failed"]);
  }
}
