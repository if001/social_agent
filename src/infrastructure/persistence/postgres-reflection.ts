import type { Pool, QueryResultRow } from "pg";
import type { z } from "zod";

import type { IdGenerator, MemoryEmbeddingPreparer } from "../../application/ports.js";
import { MemoryWriteService } from "../../application/memory-write-service.js";
import { selectReactivationAnchors, type ReactivationCandidate } from "../../application/memory-reconciliation.js";
import type { MemoryUpdateSink } from "../../application/memory-update.js";
import { ConcernReflectorOutputSchema, MemoryReconciliationOutputSchema, MemoryReflectorOutputSchema, ReflectionInputSchema, ReflectionMemoryBatchSchema, ReflectionOutputSchema, ReflectionPlanSchema, RelationshipReflectorOutputSchema, SelfMoodReflectorOutputSchema, type ReflectionInput, type ReflectionMemoryBatch, type ReflectionOutput, type ReflectionRepository, type ReflectionTarget, type ReflectorResult, type TargetedReflectionRepository } from "../../application/reflection.js";
import { AgentStateSchema, DomainError, EpisodicMemorySchema, SelfSchema, type Concern, type ConcernActivityKind, type Relationship } from "../../domain/contracts.js";

type ReflectionRow = QueryResultRow & { status: string; input: unknown };
type StateRow = QueryResultRow & { identity: string; disposition: string; self_story: string; commitments: unknown; mood: string; concerns: unknown; relationships: unknown; version: number };
type EventRow = QueryResultRow & { id: string; occurred_at: Date; summary: string };
type MemoryRow = QueryResultRow & { id: string; kind: "episodic" | "semantic" | "self-related" | "self-change" | "common-ground"; content: string; importance: string; occurred_at: Date; created_at: Date; source_agent_id: string | null; evidence_event_ids: unknown; subjects: unknown };
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

function toolExecutionsFromFailure(error: unknown): readonly unknown[] {
  if (!(error instanceof Error) || typeof error.cause !== "object" || error.cause === null || !("toolExecutions" in error.cause)) return [];
  return Array.isArray(error.cause.toolExecutions) ? error.cause.toolExecutions : [];
}

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

export class PostgresReflectionRepository implements ReflectionRepository, TargetedReflectionRepository {
  constructor(private readonly pool: Pool, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly memoryUpdateSink?: MemoryUpdateSink, private readonly memoryEmbedding?: MemoryEmbeddingPreparer, private readonly concernLifecycle: ConcernLifecycleSettings = defaultConcernLifecycleSettings) {}

  async load(reflectionId: string, agentId: string): Promise<ReflectionInput | undefined> {
    const existing = await this.pool.query<ReflectionRow>("SELECT status,input FROM reflection_runs WHERE id=$1 AND agent_id=$2", [reflectionId, agentId]);
    if (existing.rows[0] !== undefined) return ReflectionInputSchema.parse(existing.rows[0].input);
    const retry = await this.pool.query<ReflectionRow>("SELECT status,input FROM reflection_runs WHERE agent_id=$1 AND status='pending' AND failure_reason='Reflection has retryable target failures' ORDER BY updated_at ASC,id ASC LIMIT 1", [agentId]);
    if (retry.rows[0] !== undefined) return ReflectionInputSchema.parse(retry.rows[0].input);
    const stateResult = await this.pool.query<StateRow>(`SELECT a.identity,s.disposition,s.self_story,s.commitments,s.mood,s.concerns,s.relationships,s.version
      FROM agents a JOIN agent_states s ON s.agent_id=a.id WHERE a.id=$1 AND a.active=true`, [agentId]);
    const row = stateResult.rows[0]; if (row === undefined) return undefined;
    const last = await this.pool.query<{ completed_at: Date | null; event_window_end: string | null }>("SELECT completed_at,input->>'eventWindowEnd' AS event_window_end FROM reflection_runs WHERE agent_id=$1 AND status='completed' ORDER BY completed_at DESC,id DESC LIMIT 1", [agentId]);
    const since = last.rows[0]?.event_window_end === null || last.rows[0]?.event_window_end === undefined
      ? last.rows[0]?.completed_at ?? new Date(0)
      : new Date(last.rows[0].event_window_end);
    const window = await this.pool.query<{ event_window_end: Date }>("SELECT now() AS event_window_end");
    const eventWindowEnd = window.rows[0]?.event_window_end;
    if (eventWindowEnd === undefined) throw new DomainError("EXTERNAL", "Could not determine Reflection Event window");
    const [eventsResult, memoriesResult] = await Promise.all([
      this.pool.query<EventRow>("SELECT e.id,e.occurred_at,x.summary FROM events e JOIN event_experiences x ON x.event_id=e.id WHERE e.agent_id=$1 AND e.status='completed' AND e.occurred_at>$2 AND e.occurred_at<=$3 ORDER BY e.occurred_at,e.id", [agentId, since, eventWindowEnd]),
      this.pool.query<MemoryRow>(`SELECT m.id,m.kind,m.content,m.importance,m.occurred_at,m.created_at,m.source_agent_id,m.evidence_event_ids,
        COALESCE(jsonb_agg(ms.subject_id ORDER BY ms.subject_id) FILTER (WHERE ms.subject_id IS NOT NULL),'[]'::jsonb) AS subjects
        FROM memories m LEFT JOIN memory_subjects ms ON ms.memory_id=m.id WHERE m.agent_id=$1 GROUP BY m.id ORDER BY m.occurred_at DESC,m.id LIMIT 32`, [agentId])
    ]);
    if (eventsResult.rows.length === 0) return undefined;
    const input = ReflectionInputSchema.parse({
      reflectionId, agentId, eventWindowEnd: eventWindowEnd.toISOString(), expectedVersion: row.version,
      self: SelfSchema.parse({ identity: row.identity, disposition: row.disposition, selfStory: row.self_story, commitments: row.commitments }),
      state: AgentStateSchema.parse({ mood: row.mood, concerns: row.concerns, relationships: row.relationships }),
      events: eventsResult.rows.map((event) => ({ id: event.id, occurredAt: event.occurred_at.toISOString(), summary: event.summary })),
      memories: memoriesResult.rows.map((memory) => EpisodicMemorySchema.parse({ id: memory.id, summary: memory.content, significance: memory.importance, subjects: memory.subjects, occurredAt: memory.occurred_at.toISOString(), createdAt: memory.created_at.toISOString(), kind: memory.kind, evidenceEventIds: Array.isArray(memory.evidence_event_ids) ? memory.evidence_event_ids : [], ...(memory.source_agent_id === null ? {} : { source: memory.source_agent_id }) }))
    });
    await this.pool.query("INSERT INTO reflection_runs(id,agent_id,input_state_version,status,input) VALUES ($1,$2,$3,'pending',$4) ON CONFLICT (id) DO NOTHING", [reflectionId, agentId, input.expectedVersion, JSON.stringify(input)]);
    const stored = await this.pool.query<ReflectionRow>("SELECT status,input FROM reflection_runs WHERE id=$1 AND agent_id=$2", [reflectionId, agentId]);
    return stored.rows[0] === undefined ? undefined : ReflectionInputSchema.parse(stored.rows[0].input);
  }

  /**
   * A Session is deliberately refreshed after each committed target.  This is
   * not a new selection window: its Event window stays fixed, while later
   * Reflectors can ground their changes in the Memory/State just committed by
   * an earlier target in the same Session.
   */
  async refresh(input: ReflectionInput): Promise<ReflectionInput> {
    const [stateResult, memoriesResult] = await Promise.all([
      this.pool.query<StateRow>(`SELECT a.identity,s.disposition,s.self_story,s.commitments,s.mood,s.concerns,s.relationships,s.version
        FROM agents a JOIN agent_states s ON s.agent_id=a.id WHERE a.id=$1 AND a.active=true`, [input.agentId]),
      this.pool.query<MemoryRow>(`SELECT m.id,m.kind,m.content,m.importance,m.occurred_at,m.created_at,m.source_agent_id,m.evidence_event_ids,
        COALESCE(jsonb_agg(ms.subject_id ORDER BY ms.subject_id) FILTER (WHERE ms.subject_id IS NOT NULL),'[]'::jsonb) AS subjects
        FROM memories m LEFT JOIN memory_subjects ms ON ms.memory_id=m.id WHERE m.agent_id=$1 GROUP BY m.id ORDER BY m.occurred_at DESC,m.id LIMIT 32`, [input.agentId])
    ]);
    const state = stateResult.rows[0];
    if (state === undefined) throw new DomainError("NOT_FOUND", "Agent State was not found");
    return ReflectionInputSchema.parse({
      reflectionId: input.reflectionId,
      agentId: input.agentId,
      ...(input.eventWindowEnd === undefined ? {} : { eventWindowEnd: input.eventWindowEnd }),
      expectedVersion: state.version,
      self: SelfSchema.parse({ identity: state.identity, disposition: state.disposition, selfStory: state.self_story, commitments: state.commitments }),
      state: AgentStateSchema.parse({ mood: state.mood, concerns: state.concerns, relationships: state.relationships }),
      events: input.events,
      memories: memoriesResult.rows.map((memory) => EpisodicMemorySchema.parse({ id: memory.id, summary: memory.content, significance: memory.importance, subjects: memory.subjects, occurredAt: memory.occurred_at.toISOString(), createdAt: memory.created_at.toISOString(), kind: memory.kind, evidenceEventIds: Array.isArray(memory.evidence_event_ids) ? memory.evidence_event_ids : [], ...(memory.source_agent_id === null ? {} : { source: memory.source_agent_id }) }))
    });
  }

  async reconciliationInput(input: ReflectionInput): Promise<ReflectionInput> {
    // One newest eligible Memory per reason keeps the pass bounded while the
    // recorded reason makes the selection auditable in reflection_attempts.
    const rows = await this.pool.query<MemoryRow & { reason: ReactivationCandidate["reason"] }>(`WITH memory_pool AS (
      SELECT * FROM memories WHERE agent_id=$1 ORDER BY updated_at DESC,id DESC LIMIT 64
    ), candidates AS (
      SELECT m.*, 'formation'::text AS reason FROM memory_pool m JOIN memory_mutations mm ON mm.memory_id=m.id
        WHERE m.agent_id=$1 AND mm.agent_id=$1 AND mm.operation='create' AND mm.created_at >= now()-interval '30 days'
      UNION ALL
      SELECT m.*, 'concern'::text AS reason FROM memory_pool m JOIN concern_activities ca ON m.id=ANY(ARRAY(SELECT jsonb_array_elements_text(ca.evidence_memory_ids)))
        WHERE m.agent_id=$1 AND ca.agent_id=$1
      UNION ALL
      SELECT m.*, 'unreviewed'::text AS reason FROM memory_pool m WHERE NOT EXISTS (SELECT 1 FROM memory_mutations mm WHERE mm.memory_id=m.id AND mm.source_event_id LIKE 'reflection:%:reconciliation%')
      UNION ALL
      SELECT m.*, 'distant'::text AS reason FROM memory_pool m
    ), ranked AS (SELECT candidates.*, row_number() OVER (PARTITION BY reason ORDER BY CASE WHEN reason='distant' THEN occurred_at END ASC NULLS LAST, CASE WHEN reason<>'distant' THEN occurred_at END DESC NULLS LAST,id) AS row_number FROM candidates)
      SELECT r.id,r.kind,r.content,r.importance,r.occurred_at,r.created_at,r.source_agent_id,r.evidence_event_ids,
        COALESCE(jsonb_agg(ms.subject_id ORDER BY ms.subject_id) FILTER (WHERE ms.subject_id IS NOT NULL),'[]'::jsonb) AS subjects,r.reason
      FROM ranked r LEFT JOIN memory_subjects ms ON ms.memory_id=r.id WHERE r.row_number=1
      GROUP BY r.id,r.kind,r.content,r.importance,r.occurred_at,r.created_at,r.source_agent_id,r.evidence_event_ids,r.reason`, [input.agentId]);
    const candidates = rows.rows.map((row) => ({ memoryId: row.id, reason: row.reason, occurredAt: row.occurred_at.toISOString() }));
    const chosen = new Set(selectReactivationAnchors(candidates).map(({ memoryId }) => memoryId));
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    const memories = [...chosen].flatMap((id) => {
      const memory = byId.get(id); if (memory === undefined) return [];
      return [EpisodicMemorySchema.parse({ id: memory.id, summary: memory.content, significance: memory.importance, subjects: memory.subjects, occurredAt: memory.occurred_at.toISOString(), createdAt: memory.created_at.toISOString(), kind: memory.kind, evidenceEventIds: Array.isArray(memory.evidence_event_ids) ? memory.evidence_event_ids : [], ...(memory.source_agent_id === null ? {} : { source: memory.source_agent_id }) })];
    });
    return ReflectionInputSchema.parse({ ...input, memories });
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
        const plan = ReflectionPlanSchema.parse({ memory: "failed", reconciliation: "blocked", self: "blocked", relationship: "blocked", concern: "blocked", errors: [{ target: "memory", message: error instanceof Error ? error.message : "MemoryUpdate failed" }] });
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
      const plan = ReflectionPlanSchema.parse({ memory: "completed", reconciliation: "completed", self: "completed", relationship: "completed", concern: "completed", errors: [] });
      await client.query("UPDATE reflection_runs SET status='completed',plan=$2,output=$3,failure_reason=NULL,completed_at=now(),updated_at=now() WHERE id=$1", [input.reflectionId, JSON.stringify(plan), JSON.stringify(output)]);
      await client.query("COMMIT");
      return "committed";
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async fail(input: ReflectionInput, error: unknown): Promise<void> {
    await this.pool.query("UPDATE reflection_runs SET status='failed',failure_reason=$2,updated_at=now() WHERE id=$1 AND status<>'completed'", [input.reflectionId, failureReason(error)]);
  }

  async beginTarget(input: ReflectionInput, target: ReflectionTarget): Promise<"pending" | "completed"> {
    const existing = await this.pool.query<{ status: string }>("SELECT status FROM reflection_attempts WHERE reflection_id=$1 AND target=$2", [input.reflectionId, target]);
    if (existing.rows[0]?.status === "completed") return "completed";
    await this.pool.query(`INSERT INTO reflection_attempts(id,reflection_id,agent_id,target,status,input,started_at)
      VALUES ($1,$2,$3,$4,'pending',$5,now())
      ON CONFLICT (reflection_id,target) DO UPDATE SET status='pending',failure_reason=NULL,started_at=now(),updated_at=now()`, [`${input.reflectionId}:${target}`, input.reflectionId, input.agentId, target, JSON.stringify(this.#targetInput(input, target))]);
    return "pending";
  }

  async memoryBatches(input: ReflectionInput): Promise<readonly ReflectionMemoryBatch[]> {
    const batches = Array.from({ length: Math.ceil(input.events.length / 16) }, (_, batchIndex) => ReflectionMemoryBatchSchema.parse({ batchIndex, events: input.events.slice(batchIndex * 16, (batchIndex + 1) * 16) }));
    for (const batch of batches) await this.pool.query(`INSERT INTO reflection_memory_batches(id,reflection_id,agent_id,batch_index,status,input)
      VALUES ($1,$2,$3,$4,'pending',$5) ON CONFLICT (reflection_id,batch_index) DO NOTHING`, [`${input.reflectionId}:memory:${String(batch.batchIndex)}`, input.reflectionId, input.agentId, batch.batchIndex, JSON.stringify(batch)]);
    return batches;
  }

  async beginMemoryBatch(input: ReflectionInput, batch: ReflectionMemoryBatch): Promise<"pending" | "completed"> {
    const existing = await this.pool.query<{ status: string }>("SELECT status FROM reflection_memory_batches WHERE reflection_id=$1 AND batch_index=$2", [input.reflectionId, batch.batchIndex]);
    if (existing.rows[0]?.status === "completed") return "completed";
    await this.pool.query("UPDATE reflection_memory_batches SET status='pending',failure_reason=NULL,started_at=now(),updated_at=now() WHERE reflection_id=$1 AND batch_index=$2", [input.reflectionId, batch.batchIndex]);
    return "pending";
  }

  async commitMemoryBatch(input: ReflectionInput, batch: ReflectionMemoryBatch, result: ReflectorResult): Promise<void> {
    await this.#commitMemoryTarget({ ...input, events: batch.events }, MemoryReflectorOutputSchema.parse(result.output), `${input.reflectionId}:memory:${String(batch.batchIndex)}`);
    await this.pool.query("UPDATE reflection_memory_batches SET status='completed',output=$3,tool_executions=$4,failure_reason=NULL,completed_at=now(),updated_at=now() WHERE reflection_id=$1 AND batch_index=$2", [input.reflectionId, batch.batchIndex, JSON.stringify(result.output), JSON.stringify(result.toolExecutions)]);
  }

  async failMemoryBatch(input: ReflectionInput, batch: ReflectionMemoryBatch, error: unknown): Promise<void> {
    await this.pool.query("UPDATE reflection_memory_batches SET status='failed',failure_reason=$3,tool_executions=$4,updated_at=now() WHERE reflection_id=$1 AND batch_index=$2", [input.reflectionId, batch.batchIndex, failureReason(error), JSON.stringify(toolExecutionsFromFailure(error))]);
  }

  async completeMemoryTarget(input: ReflectionInput): Promise<void> {
    const batches = await this.pool.query<{ batch_index: number; status: string; output: unknown }>("SELECT batch_index,status,output FROM reflection_memory_batches WHERE reflection_id=$1 ORDER BY batch_index", [input.reflectionId]);
    if (batches.rows.length === 0 || batches.rows.some(({ status }) => status !== "completed")) throw new DomainError("CONFLICT", "Reflection Memory batches are not all completed");
    await this.pool.query("UPDATE reflection_attempts SET status='completed',output=$2,failure_reason=NULL,completed_at=now(),updated_at=now() WHERE reflection_id=$1 AND target='memory'", [input.reflectionId, JSON.stringify({ batches: batches.rows.map(({ batch_index, output }) => ({ batchIndex: batch_index, output })) })]);
  }

  async commitTarget(input: ReflectionInput, target: ReflectionTarget, result: ReflectorResult): Promise<void> {
    if (target === "memory") await this.#commitMemoryTarget(input, MemoryReflectorOutputSchema.parse(result.output));
    if (target === "reconciliation") await this.#commitReconciliationTarget(input, MemoryReconciliationOutputSchema.parse(result.output));
    if (target === "concern") await this.#commitConcernTarget(input, ConcernReflectorOutputSchema.parse(result.output));
    if (target === "relationship") await this.#commitRelationshipTarget(input, RelationshipReflectorOutputSchema.parse(result.output));
    if (target === "self-mood") await this.#commitSelfMoodTarget(input, SelfMoodReflectorOutputSchema.parse(result.output));
    await this.pool.query("UPDATE reflection_attempts SET status='completed',output=$3,tool_executions=$4,failure_reason=NULL,completed_at=now(),updated_at=now() WHERE reflection_id=$1 AND target=$2", [input.reflectionId, target, JSON.stringify(result.output), JSON.stringify(result.toolExecutions)]);
  }

  async failTarget(input: ReflectionInput, target: ReflectionTarget, error: unknown): Promise<void> {
    await this.pool.query("UPDATE reflection_attempts SET status='failed',failure_reason=$3,tool_executions=$4,updated_at=now() WHERE reflection_id=$1 AND target=$2", [input.reflectionId, target, failureReason(error), JSON.stringify(toolExecutionsFromFailure(error))]);
  }

  async blockTarget(input: ReflectionInput, target: ReflectionTarget): Promise<void> {
    await this.pool.query(`INSERT INTO reflection_attempts(id,reflection_id,agent_id,target,status,input,completed_at)
      VALUES ($1,$2,$3,$4,'blocked',$5,now())
      ON CONFLICT (reflection_id,target) DO UPDATE SET status='blocked',updated_at=now()`, [`${input.reflectionId}:${target}`, input.reflectionId, input.agentId, target, JSON.stringify(this.#targetInput(input, target))]);
  }

  async complete(input: ReflectionInput): Promise<void> {
    const rows = await this.pool.query<{ target: string; status: string; failure_reason: string | null }>("SELECT target,status,failure_reason FROM reflection_attempts WHERE reflection_id=$1 ORDER BY target", [input.reflectionId]);
    const attempts = new Map(rows.rows.map((row) => [row.target, row]));
    const plan = ReflectionPlanSchema.parse({
      memory: attempts.get("memory")?.status ?? "pending",
      reconciliation: attempts.get("reconciliation")?.status ?? "pending",
      concern: attempts.get("concern")?.status ?? "pending",
      relationship: attempts.get("relationship")?.status ?? "pending",
      self: attempts.get("self-mood")?.status ?? "pending",
      errors: rows.rows.filter((row) => row.status === "failed" && row.failure_reason !== null).map((row) => ({ target: row.target === "self-mood" ? "self" : row.target, message: row.failure_reason ?? "Reflection target failed" }))
    });
    const retryable = rows.rows.some((row) => row.status === "failed" || row.status === "blocked");
    if (attempts.get("concern")?.status === "completed") {
      const state = await this.pool.query<{ concerns: unknown; relationships: unknown; version: number }>("SELECT concerns,relationships,version FROM agent_states WHERE agent_id=$1", [input.agentId]);
      const current = state.rows[0];
      if (current !== undefined) {
        const activity = await this.pool.query<{ concern_id: string }>("SELECT DISTINCT concern_id FROM concern_activities WHERE agent_id=$1 AND reflection_id=$2", [input.agentId, input.reflectionId]);
        const parsed = AgentStateSchema.parse({ concerns: current.concerns, relationships: current.relationships });
        const closed = await this.#closeStaleConcerns(this.pool, input.agentId, input.reflectionId, parsed.concerns, new Set(activity.rows.map(({ concern_id }) => concern_id)), this.now());
        if (JSON.stringify(closed) !== JSON.stringify(parsed.concerns)) await this.pool.query("UPDATE agent_states SET concerns=$3,version=version+1,updated_at=now() WHERE agent_id=$1 AND version=$2", [input.agentId, current.version, JSON.stringify(closed)]);
      }
    }
    await this.pool.query("UPDATE reflection_runs SET status=$2,plan=$3,failure_reason=$4,completed_at=CASE WHEN $2='completed' THEN now() ELSE NULL END,updated_at=now() WHERE id=$1", [input.reflectionId, retryable ? "pending" : "completed", JSON.stringify(plan), plan.errors[0]?.message ?? null]);
    if (retryable) throw new DomainError("EXTERNAL", "Reflection has retryable target failures");
  }

  #targetInput(input: ReflectionInput, target: ReflectionTarget): unknown {
    // Memory batch inputs are persisted in reflection_memory_batches.  Keeping
    // only their count here prevents a maintenance-attempt audit row from
    // accidentally becoming a second, unbounded model input.
    if (target === "memory") return { eventCount: input.events.length, batchCount: Math.ceil(input.events.length / 16) };
    if (target === "reconciliation") return { anchors: input.memories.map(({ id, kind, summary, significance, occurredAt }) => ({ id, kind, summary, significance, occurredAt })) };
    if (target === "concern") return { memories: input.memories.map(({ id, summary, significance, subjects, occurredAt }) => ({ id, summary, significance, subjects, occurredAt })), concerns: input.state.concerns };
    if (target === "relationship") return { events: input.events.slice(-32), memories: input.memories.map(({ id, summary, significance, subjects, occurredAt }) => ({ id, summary, significance, subjects, occurredAt })), relationships: input.state.relationships };
    return { self: input.self, mood: input.state.mood, memories: input.memories.map(({ id, summary, significance, subjects, occurredAt }) => ({ id, summary, significance, subjects, occurredAt })) };
  }

  async #commitConcernTarget(input: ReflectionInput, output: z.infer<typeof ConcernReflectorOutputSchema>): Promise<void> {
    const state = await this.pool.query<{ concerns: unknown; version: number }>("SELECT concerns,version FROM agent_states WHERE agent_id=$1", [input.agentId]);
    const row = state.rows[0]; if (row === undefined) throw new DomainError("NOT_FOUND", "Agent State was not found");
    const applied = applyConcerns(AgentStateSchema.parse({ concerns: row.concerns, relationships: [] }).concerns, output.concernChanges, () => this.ids.next());
    const updated = await this.pool.query("UPDATE agent_states SET concerns=$3,version=version+1,updated_at=now() WHERE agent_id=$1 AND version=$2", [input.agentId, row.version, JSON.stringify(applied.concerns)]);
    if (updated.rowCount !== 1) throw new DomainError("CONFLICT", "Reflection Concern state version conflict");
    const at = this.now();
    for (const [index, activity] of applied.activities.entries()) await this.pool.query("INSERT INTO concern_activities(id,agent_id,concern_id,kind,reflection_id,evidence_memory_ids,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (id) DO NOTHING", [`reflection:${input.reflectionId}:target-concern:${String(index)}:${activity.kind}:${activity.concernId}`, input.agentId, activity.concernId, activity.kind, input.reflectionId, JSON.stringify(output.evidenceMemoryIds), at]);
  }

  async #commitMemoryTarget(input: ReflectionInput, output: z.infer<typeof MemoryReflectorOutputSchema>, sourceEventId = input.reflectionId): Promise<void> {
    const intents = output.memories.map((memory) => ({ content: memory.content, reason: memory.reason, evidenceEventIds: memory.evidenceEventIds, confidence: "medium" as const, target: memory.target, perspective: memory.perspective, purpose: memory.perspective === "user" ? "user-context" as const : "self-guidance" as const }));
    if (this.memoryUpdateSink !== undefined && intents.length > 0) {
      const sinkInput = { agentId: input.agentId, sourceEventId, intents, subjectsByIntent: output.memories.map(({ subjects }) => subjects), formation: true };
      if (this.memoryUpdateSink.enqueueAndWait !== undefined) await this.memoryUpdateSink.enqueueAndWait(sinkInput); else await this.memoryUpdateSink.enqueue(sinkInput);
      return;
    }
    const embeddingPreparer = this.memoryEmbedding;
    const embeddings = embeddingPreparer === undefined ? [] : await Promise.all(output.memories.map(({ content }) => embeddingPreparer.prepareMemory(content)));
    const client = await this.pool.connect();
    try {
      for (const [index, memory] of output.memories.entries()) {
        const intent = intents[index]; if (intent === undefined) throw new DomainError("VALIDATION", "Reflection Memory intent was not created");
        await new MemoryWriteService(client, this.ids, this.now).apply(input.agentId, intent, { subjectIds: memory.subjects, sourceEventId, intentIndex: index, candidates: [], ...(embeddings[index] === undefined ? {} : { embedding: embeddings[index] }) });
      }
    } finally { client.release(); }
  }

  async #commitReconciliationTarget(input: ReflectionInput, output: z.infer<typeof MemoryReconciliationOutputSchema>): Promise<void> {
    const anchors = new Map(input.memories.map((memory) => [memory.id, memory]));
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      for (const [index, change] of output.changes.entries()) {
        const anchor = anchors.get(change.memoryId);
        if (anchor === undefined) throw new DomainError("VALIDATION", "Reconciliation anchor is not available");
        const sourceEventId = `${input.reflectionId}:reconciliation`;
        if (change.operation !== "keep" && anchor.kind === "episodic") throw new DomainError("VALIDATION", "Episodic Memory cannot be changed");
        if (change.evidenceEventIds.length > 0) {
          const evidence = await client.query<{ id: string; occurred_at: Date }>("SELECT id,occurred_at FROM events WHERE agent_id=$1 AND id=ANY($2::text[])", [input.agentId, change.evidenceEventIds]);
          if (evidence.rows.length !== change.evidenceEventIds.length || evidence.rows.some((event) => event.occurred_at < new Date(anchor.occurredAt))) {
            throw new DomainError("VALIDATION", "Memory Reconciliation can only update from known later Events");
          }
        }
        await new MemoryWriteService(client, this.ids, this.now).reconcile(input.agentId, change, { sourceEventId, intentIndex: index });
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async #commitRelationshipTarget(input: ReflectionInput, output: z.infer<typeof RelationshipReflectorOutputSchema>): Promise<void> {
    const state = await this.pool.query<{ relationships: unknown; version: number }>("SELECT relationships,version FROM agent_states WHERE agent_id=$1", [input.agentId]);
    const row = state.rows[0]; if (row === undefined) throw new DomainError("NOT_FOUND", "Agent State was not found");
    const relationships = applyRelationships(AgentStateSchema.parse({ concerns: [], relationships: row.relationships }).relationships, output.relationshipChanges);
    const updated = await this.pool.query("UPDATE agent_states SET relationships=$3,version=version+1,updated_at=now() WHERE agent_id=$1 AND version=$2", [input.agentId, row.version, JSON.stringify(relationships)]);
    if (updated.rowCount !== 1) throw new DomainError("CONFLICT", "Reflection Relationship state version conflict");
  }

  async #commitSelfMoodTarget(input: ReflectionInput, output: z.infer<typeof SelfMoodReflectorOutputSchema>): Promise<void> {
    const state = await this.pool.query<{ disposition: string; self_story: string; commitments: unknown; mood: string; version: number }>("SELECT disposition,self_story,commitments,mood,version FROM agent_states WHERE agent_id=$1", [input.agentId]);
    const row = state.rows[0]; if (row === undefined) throw new DomainError("NOT_FOUND", "Agent State was not found");
    const self = output.self;
    const updated = await this.pool.query("UPDATE agent_states SET disposition=$3,self_story=$4,commitments=$5,mood=$6,version=version+1,updated_at=now() WHERE agent_id=$1 AND version=$2", [input.agentId, row.version, self?.disposition ?? row.disposition, self?.selfStory ?? row.self_story, JSON.stringify(self?.commitments ?? row.commitments), output.mood ?? row.mood]);
    if (updated.rowCount !== 1) throw new DomainError("CONFLICT", "Reflection Self/Mood state version conflict");
    if (self !== undefined) await this.pool.query("UPDATE agents SET identity=$2,updated_at=now() WHERE id=$1", [input.agentId, self.identity]);
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
