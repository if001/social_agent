import type { Pool, QueryResultRow } from "pg";

import type { IdGenerator, MemoryEmbeddingPreparer } from "../../application/ports.js";
import { MemoryWriteService } from "../../application/memory-write-service.js";
import type { MemoryUpdateSink } from "../../application/memory-update.js";
import { ReflectionInputSchema, ReflectionOutputSchema, ReflectionPlanSchema, type ReflectionInput, type ReflectionOutput, type ReflectionRepository } from "../../application/reflection.js";
import { AgentStateSchema, DomainError, EpisodicMemorySchema, SelfSchema, type Concern, type ConcernActivityKind, type Relationship } from "../../domain/contracts.js";

type ReflectionRow = QueryResultRow & { status: string; input: unknown };
type StateRow = QueryResultRow & { identity: string; disposition: string; self_story: string; commitments: unknown; mood: string; concerns: unknown; relationships: unknown; version: number };
type EventRow = QueryResultRow & { id: string; occurred_at: Date; observation: unknown };
type MemoryRow = QueryResultRow & { id: string; content: string; importance: string; occurred_at: Date; created_at: Date; source_agent_id: string | null; subjects: unknown };
type StaleConcernRow = QueryResultRow & { last_meaningful_at: Date | null; reflection_sessions: string };

export type ConcernLifecycleSettings = {
  readonly staleAfterMs: number;
  readonly minReflectionSessions: number;
};

const defaultConcernLifecycleSettings: ConcernLifecycleSettings = { staleAfterMs: 2_592_000_000, minReflectionSessions: 2 };

function failureReason(error: unknown): string {
  if (!(error instanceof Error)) return "Reflection failed";
  const cause = error.cause;
  if (typeof cause !== "object" || cause === null || !("validationIssues" in cause) || !Array.isArray(cause.validationIssues)) return error.message;
  const issues = cause.validationIssues.slice(0, 8).flatMap((value) => {
    if (typeof value !== "object" || value === null) return [];
    const issue = value as { path?: unknown; message?: unknown; code?: unknown };
    return [{ ...(Array.isArray(issue.path) ? { path: issue.path.map(String) } : {}), ...(typeof issue.message === "string" ? { message: issue.message } : {}), ...(typeof issue.code === "string" ? { code: issue.code } : {}) }];
  });
  return issues.length === 0 ? error.message : `${error.message}: ${JSON.stringify(issues)}`;
}

const summaryOf = (observation: unknown): string => {
  if (typeof observation === "object" && observation !== null && "summary" in observation && typeof observation.summary === "string" && observation.summary.trim() !== "") return observation.summary;
  return "記録された出来事";
};

type AppliedConcerns = { readonly concerns: readonly Concern[]; readonly activities: readonly { readonly concernId: string; readonly kind: ConcernActivityKind }[] };

function applyConcerns(current: readonly Concern[], changes: ReflectionOutput["concernChanges"], nextId: () => string): AppliedConcerns {
  const values = new Map(current.map((value) => [value.id, value]));
  const activities: { concernId: string; kind: ConcernActivityKind }[] = [];
  for (const change of changes) {
    if (change.operation === "remove") { values.delete(change.id); activities.push({ concernId: change.id, kind: "removed" }); continue; }
    if (change.operation === "create") { const id = nextId(); values.set(id, { ...change.concern, id }); activities.push({ concernId: id, kind: "created" }); continue; }
    const previous = values.get(change.concern.id);
    values.set(change.concern.id, change.concern);
    activities.push({ concernId: change.concern.id, kind: "reviewed" });
    if (previous !== undefined && previous.status !== change.concern.status) activities.push({ concernId: change.concern.id, kind: "status-changed" });
  }
  return { concerns: [...values.values()], activities };
}

function applyRelationships(current: readonly Relationship[], changes: ReflectionOutput["relationshipChanges"]): Relationship[] {
  const values = new Map(current.map((value) => [value.subjectId, value]));
  for (const change of changes) if (change.operation === "remove") values.delete(change.subjectId); else values.set(change.relationship.subjectId, change.relationship);
  return [...values.values()];
}

export class PostgresReflectionRepository implements ReflectionRepository {
  constructor(private readonly pool: Pool, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly memoryUpdateSink?: MemoryUpdateSink, private readonly memoryEmbedding?: MemoryEmbeddingPreparer, private readonly concernLifecycle: ConcernLifecycleSettings = defaultConcernLifecycleSettings) {}

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
    const output = ReflectionOutputSchema.parse(rawOutput);
    const reflectionIntents = output.memories.map((memory) => ({ content: memory.summary, reason: memory.significance, evidenceEventIds: input.events.map(({ id: eventId }) => eventId), confidence: "medium" as const, target: "episodic" as const, perspective: memory.subjects.length > 0 ? "user" as const : "self" as const, purpose: memory.subjects.length > 0 ? "user-context" as const : "self-guidance" as const }));
    if (this.memoryUpdateSink !== undefined && reflectionIntents.length > 0) {
      const sinkInput = { agentId: input.agentId, sourceEventId: input.reflectionId, intents: reflectionIntents, subjectsByIntent: output.memories.map((memory) => memory.subjects), sourceAgentIds: output.memories.map((memory) => memory.source) };
      try {
        if (this.memoryUpdateSink.enqueueAndWait !== undefined) await this.memoryUpdateSink.enqueueAndWait(sinkInput);
        else await this.memoryUpdateSink.enqueue(sinkInput);
      } catch (error) {
        const plan = ReflectionPlanSchema.parse({ memory: "failed", self: "blocked", relationship: "blocked", concern: "blocked", errors: [{ target: "memory", message: error instanceof Error ? error.message : "MemoryUpdate failed" }] });
        await this.pool.query("UPDATE reflection_runs SET status='pending',plan=$2,failure_reason=$3,updated_at=now() WHERE id=$1 AND status<>'completed'", [input.reflectionId, JSON.stringify(plan), plan.errors[0]?.message ?? "MemoryUpdate failed"]);
        return "committed";
      }
    }
    const embeddingPreparer = this.memoryEmbedding;
    const memoryEmbeddings = this.memoryUpdateSink === undefined && embeddingPreparer !== undefined
      ? await Promise.all(output.memories.map((memory) => embeddingPreparer.prepareMemory(memory.summary)))
      : [];
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const run = await client.query<{ status: string }>("SELECT status FROM reflection_runs WHERE id=$1 AND agent_id=$2 FOR UPDATE", [input.reflectionId, input.agentId]);
      if (run.rows[0]?.status === "completed") { await client.query("COMMIT"); return "duplicate"; }
      if (run.rows[0] === undefined) throw new DomainError("NOT_FOUND", "Reflection run was not found");
      const appliedConcerns = applyConcerns(input.state.concerns, output.concernChanges, () => this.ids.next());
      const occurredAt = this.now();
      for (const [index, activity] of appliedConcerns.activities.entries()) await client.query("INSERT INTO concern_activities(id,agent_id,concern_id,kind,reflection_id,evidence_memory_ids,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING", [`reflection:${input.reflectionId}:change:${String(index)}:${activity.kind}:${activity.concernId}`, input.agentId, activity.concernId, activity.kind, input.reflectionId, JSON.stringify(output.evidenceMemoryIds), occurredAt]);
      for (const [index, concern] of input.state.concerns.filter(({ status }) => status === "active").entries()) await client.query("INSERT INTO concern_activities(id,agent_id,concern_id,kind,reflection_id,evidence_memory_ids,occurred_at) VALUES ($1,$2,$3,'presented',$4,'[]',$5) ON CONFLICT (id) DO NOTHING", [`reflection:${input.reflectionId}:presented:${String(index)}:${concern.id}`, input.agentId, concern.id, input.reflectionId, occurredAt]);
      const closedConcerns = await this.#closeStaleConcerns(client, input.agentId, input.reflectionId, appliedConcerns.concerns, new Set(appliedConcerns.activities.map(({ concernId }) => concernId)), occurredAt);
      const state = AgentStateSchema.parse({ ...input.state, ...(output.mood === undefined ? {} : { mood: output.mood }), concerns: closedConcerns, relationships: applyRelationships(input.state.relationships, output.relationshipChanges) });
      const self = output.self ?? input.self;
      const updated = await client.query("UPDATE agent_states SET disposition=$3,self_story=$4,commitments=$5,concerns=$6,relationships=$7,mood=COALESCE($8,mood),version=version+1,updated_at=now() WHERE agent_id=$1 AND version=$2 RETURNING version", [input.agentId, input.expectedVersion, self.disposition, self.selfStory, JSON.stringify(self.commitments), JSON.stringify(state.concerns), JSON.stringify(state.relationships), state.mood ?? null]);
      if (updated.rowCount !== 1) throw new DomainError("CONFLICT", "Reflection state version conflict");
      if (self.identity !== input.self.identity) await client.query("UPDATE agents SET identity=$2,updated_at=now() WHERE id=$1", [input.agentId, self.identity]);
      await client.query("DELETE FROM autonomous_schedules WHERE agent_id=$1 AND kind='concern-due'", [input.agentId]);
      for (const concern of state.concerns) {
        if (concern.status !== "active" || concern.reconsiderAt === undefined) continue;
        await client.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ($1,$2,'concern-due',$3,$4)", [`concern:${concern.id}`, input.agentId, concern.whyItMatters, concern.reconsiderAt]);
      }
      const reflectionCandidates = input.memories.map((memory) => ({ id: memory.id, kind: "episodic", content: memory.summary, importance: memory.significance }));
      if (this.memoryUpdateSink === undefined) {
        for (const [memoryIndex, memory] of output.memories.entries()) {
          await new MemoryWriteService(client, this.ids, this.now).apply(input.agentId, reflectionIntents[memoryIndex] ?? { content: memory.summary, reason: memory.significance, evidenceEventIds: [], confidence: "low", target: "episodic", perspective: memory.subjects.length > 0 ? "user" : "self", purpose: memory.subjects.length > 0 ? "user-context" : "self-guidance" }, { subjectIds: memory.subjects, sourceEventId: input.reflectionId, intentIndex: memoryIndex, candidates: reflectionCandidates, ...(memory.source === undefined ? {} : { sourceAgentId: memory.source }), ...(memoryEmbeddings[memoryIndex] === undefined ? {} : { embedding: memoryEmbeddings[memoryIndex] }) });
        }
      }
      const plan = ReflectionPlanSchema.parse({ memory: "completed", self: "completed", relationship: "completed", concern: "completed", errors: [] });
      await client.query("UPDATE reflection_runs SET status='completed',plan=$2,output=$3,failure_reason=NULL,completed_at=now(),updated_at=now() WHERE id=$1", [input.reflectionId, JSON.stringify(plan), JSON.stringify(output)]);
      await client.query("COMMIT");
      return "committed";
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async fail(input: ReflectionInput, error: unknown): Promise<void> {
    await this.pool.query("UPDATE reflection_runs SET status='failed',failure_reason=$2,updated_at=now() WHERE id=$1 AND status<>'completed'", [input.reflectionId, failureReason(error)]);
  }

  async #closeStaleConcerns(client: Pick<Pool, "query">, agentId: string, reflectionId: string, concerns: readonly Concern[], changedConcernIds: ReadonlySet<string>, now: Date): Promise<readonly Concern[]> {
    const next = [...concerns];
    for (const [index, concern] of concerns.entries()) {
      if (concern.status !== "active" || changedConcernIds.has(concern.id)) continue;
      if (concern.reconsiderAt !== undefined && Date.parse(concern.reconsiderAt) > now.getTime()) continue;
      const row = (await client.query<StaleConcernRow>(`WITH marker AS (
          SELECT max(occurred_at) AS occurred_at FROM concern_activities
          WHERE agent_id=$1 AND concern_id=$2 AND kind=ANY($3::text[])
        )
        SELECT marker.occurred_at AS last_meaningful_at,
          count(DISTINCT activity.reflection_id) FILTER (WHERE session.id IS NOT NULL)::text AS reflection_sessions
        FROM marker LEFT JOIN concern_activities activity
          ON activity.agent_id=$1 AND activity.concern_id=$2 AND activity.kind='presented'
          AND activity.reflection_id IS NOT NULL AND activity.occurred_at>=marker.occurred_at
        LEFT JOIN reflection_runs session ON session.id=activity.reflection_id AND session.agent_id=$1
          AND (session.status='completed' OR session.id=$4)
        GROUP BY marker.occurred_at`, [agentId, concern.id, ["baseline", "created", "derived", "reviewed", "focused", "progressed", "status-changed"], reflectionId])).rows[0];
      if (row?.last_meaningful_at === null || row?.last_meaningful_at === undefined) continue;
      if (now.getTime() - row.last_meaningful_at.getTime() < this.concernLifecycle.staleAfterMs) continue;
      if (Number(row.reflection_sessions) < this.concernLifecycle.minReflectionSessions) continue;
      next[index] = { ...concern, status: "abandoned", reconsiderAt: undefined };
      for (const kind of ["status-changed", "closed"] as const) await client.query("INSERT INTO concern_activities(id,agent_id,concern_id,kind,reflection_id,evidence_memory_ids,occurred_at) VALUES ($1,$2,$3,$4,$5,'[]',$6) ON CONFLICT (id) DO NOTHING", [`reflection:${reflectionId}:close:${String(index)}:${kind}:${concern.id}`, agentId, concern.id, kind, reflectionId, now]);
    }
    return next;
  }
}
