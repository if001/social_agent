import { and, asc, desc, eq, gt, gte, inArray, isNotNull, lte, ne, sql } from "drizzle-orm";
import type { Pool, QueryResultRow } from "pg";
import type { z } from "zod";

import type { IdGenerator, MemoryEmbeddingPreparer } from "../../application/ports.js";
import { MemoryWriteService, recordMemoryMutationFailure } from "./memory-write-repository.js";
import { reflectionConcernContext } from "../../application/reflection-concern-context.js";
import { selectReactivationAnchors, type ReactivationCandidate } from "../../application/memory-reconciliation.js";
import type { MemoryUpdateSink } from "../../application/memory-update.js";
import { userMainSubjectId } from "../../application/canonical-subject.js";
import { ConcernLifecycleService } from "../../application/concern-lifecycle.js";
import { ConcernReflectorOutputSchema, MemoryReconciliationOutputSchema, MemoryReflectorOutputSchema, ReflectionInputSchema, ReflectionMemoryBatchSchema, ReflectionOutputSchema, ReflectionPlanSchema, RelationshipReflectorOutputSchema, SelfMoodReflectorOutputSchema, type ReflectionInput, type ReflectionMemoryBatch, type ReflectionOutput, type ReflectionRepository, type ReflectionTarget, type ReflectorResult, type TargetedReflectionRepository } from "../../application/reflection.js";
import { AgentStateSchema, DomainError, EpisodicMemorySchema, PersistedSelfSchema, ToolExecutionRecordSchema, type Concern, type ConcernActivityKind, type ConcernChangeSchema, type Relationship, type RelationshipChangeSchema, type ToolExecutionRecord } from "../../domain/contracts.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { agents, agentStates, autonomousSchedules, concernActivities, concerns as concernRecords, eventExperiences, events, memories, memorySubjects, observationGateDecisions, reflectionAttempts, reflectionMemoryBatches, reflectionResolutions, reflectionRuns, reflectionToolExecutions } from "./schema.js";
import { ConcernRepository } from "./concern-repository.js";

type ConcernChange = z.infer<typeof ConcernChangeSchema>;
type RelationshipChange = z.infer<typeof RelationshipChangeSchema>;
type EventProjectionRow = QueryResultRow & { id: string; content: string; subjects: unknown; occurred_at: Date; vector_score: number | null };
type MemoryRow = QueryResultRow & { id: string; kind: "episodic" | "semantic" | "self-related" | "self-change" | "common-ground"; content: string; importance: string; occurred_at: Date; created_at: Date; source_agent_id: string | null; evidence_event_ids: unknown; subjects: unknown };
type ReflectionTransaction = Parameters<Parameters<RuntimeDatabase["transaction"]>[0]>[0];

export type ConcernLifecycleSettings = {
  readonly staleAfterMs: number;
  readonly minReflectionSessions: number;
};

const defaultConcernLifecycleSettings: ConcernLifecycleSettings = { staleAfterMs: 2_592_000_000, minReflectionSessions: 2 };
const formationResolverVersion = "formation-hybrid-v1";
const formationMinimumScore = 0.16;

function formationTerms(value: string): readonly string[] {
  return [...new Set(value.toLocaleLowerCase("ja-JP").split(/[\s、。,.!?！？「」()（）]+/u).map((term) => term.trim()).filter((term) => term.length >= 2))];
}

function scoreKeyword(queryTerms: readonly string[], content: string): number {
  if (queryTerms.length === 0) return 0;
  const haystack = content.toLocaleLowerCase("ja-JP");
  return queryTerms.filter((term) => haystack.includes(term)).length / queryTerms.length;
}

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

function toolExecutionsFromFailure(error: unknown): readonly ToolExecutionRecord[] {
  if (!(error instanceof Error) || typeof error.cause !== "object" || error.cause === null || !("toolExecutions" in error.cause)) return [];
  if (!Array.isArray(error.cause.toolExecutions)) return [];
  return error.cause.toolExecutions.flatMap((record) => {
    const parsed = ToolExecutionRecordSchema.safeParse(record);
    return parsed.success ? [parsed.data] : [];
  });
}

const concernLifecycle = new ConcernLifecycleService();

function applyRelationships(current: readonly Relationship[], changes: ReflectionOutput["relationshipChanges"]): Relationship[] {
  const values = new Map(current.map((value) => [value.subjectId, value]));
  for (const change of changes) if (change.operation === "remove") values.delete(change.subjectId); else values.set(change.relationship.subjectId, change.relationship);
  return [...values.values()];
}

export class PostgresReflectionRepository implements ReflectionRepository, TargetedReflectionRepository {
  constructor(private readonly database: RuntimeDatabase, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly memoryUpdateSink?: MemoryUpdateSink, private readonly memoryEmbedding?: MemoryEmbeddingPreparer, private readonly concernLifecycle: ConcernLifecycleSettings = defaultConcernLifecycleSettings) {}

  /** PostgreSQL-native access is limited to complex ranking/RAG queries. */
  private get pool(): Pool { return this.database.native; }

  async #state(agentId: string) {
    const row = await this.database.db.select({ identity: agents.identity, disposition: agentStates.disposition, selfStory: agentStates.selfStory, commitments: agentStates.commitments, mood: agentStates.mood, relationships: agentStates.relationships, version: agentStates.version })
      .from(agents).innerJoin(agentStates, eq(agentStates.agentId, agents.id)).where(and(eq(agents.id, agentId), eq(agents.active, true))).limit(1).then((rows) => rows[0]);
    return row === undefined ? undefined : { ...row, concerns: await new ConcernRepository(this.database.db).list(agentId) };
  }

  async #memories(agentId: string) {
    const rows = await this.database.db.select().from(memories).where(eq(memories.agentId, agentId)).orderBy(desc(memories.occurredAt), desc(memories.id)).limit(32);
    const ids = rows.map(({ id }) => id);
    const subjects = ids.length === 0 ? [] : await this.database.db.select().from(memorySubjects).where(inArray(memorySubjects.memoryId, ids)).orderBy(memorySubjects.subjectId);
    const byMemory = new Map<string, string[]>();
    for (const subject of subjects) byMemory.set(subject.memoryId, [...(byMemory.get(subject.memoryId) ?? []), subject.subjectId]);
    return rows.map((memory) => EpisodicMemorySchema.parse({ id: memory.id, summary: memory.content, significance: memory.importance, subjects: byMemory.get(memory.id) ?? [], occurredAt: memory.occurredAt.toISOString(), createdAt: memory.createdAt.toISOString(), kind: memory.kind, evidenceEventIds: Array.isArray(memory.evidenceEventIds) ? memory.evidenceEventIds : [], ...(memory.sourceAgentId === null ? {} : { source: memory.sourceAgentId }) }));
  }

  async load(reflectionId: string, agentId: string): Promise<ReflectionInput | undefined> {
    const existing = await this.database.db.select({ input: reflectionRuns.input }).from(reflectionRuns).where(and(eq(reflectionRuns.id, reflectionId), eq(reflectionRuns.agentId, agentId))).limit(1);
    if (existing[0] !== undefined) return ReflectionInputSchema.parse(existing[0].input);
    const retry = await this.database.db.select({ input: reflectionRuns.input }).from(reflectionRuns).where(and(eq(reflectionRuns.agentId, agentId), eq(reflectionRuns.status, "pending"), eq(reflectionRuns.failureReason, "Reflection has retryable target failures"))).orderBy(asc(reflectionRuns.updatedAt), asc(reflectionRuns.id)).limit(1);
    if (retry[0] !== undefined) return ReflectionInputSchema.parse(retry[0].input);
    const row = await this.#state(agentId); if (row === undefined) return undefined;
    const last = await this.database.db.select({ completedAt: reflectionRuns.completedAt, input: reflectionRuns.input }).from(reflectionRuns).where(and(eq(reflectionRuns.agentId, agentId), eq(reflectionRuns.status, "completed"))).orderBy(desc(reflectionRuns.completedAt), desc(reflectionRuns.id)).limit(1);
    const previousInput = last[0]?.input as { eventWindowEnd?: unknown } | undefined;
    const since = typeof previousInput?.eventWindowEnd === "string" ? new Date(previousInput.eventWindowEnd) : last[0]?.completedAt ?? new Date(0);
    // PostgreSQL-native database clock keeps the fixed Event window aligned
    // with occurred_at values written by other workers and test fixtures.
    const window = await this.database.db.execute(sql<{ eventWindowEnd: Date | string }>`SELECT now() AS "eventWindowEnd"`);
    const windowValue = window.rows[0]?.eventWindowEnd;
    if (!(windowValue instanceof Date) && typeof windowValue !== "string") throw new DomainError("EXTERNAL", "Could not determine Reflection Event window");
    const eventWindowEnd = windowValue instanceof Date ? windowValue : new Date(windowValue);
    const [eventRows, memoryRows] = await Promise.all([
      this.database.db.select({ id: events.id, occurredAt: events.occurredAt, summary: eventExperiences.summary }).from(events).innerJoin(eventExperiences, eq(eventExperiences.eventId, events.id)).where(and(eq(events.agentId, agentId), eq(events.status, "completed"), gt(events.occurredAt, since), lte(events.occurredAt, eventWindowEnd))).orderBy(asc(events.occurredAt), asc(events.id)),
      this.#memories(agentId)
    ]);
    if (eventRows.length === 0) return undefined;
    const input = ReflectionInputSchema.parse({
      reflectionId, agentId, eventWindowEnd: eventWindowEnd.toISOString(), expectedVersion: row.version,
      self: PersistedSelfSchema.parse({ identity: row.identity, disposition: row.disposition, selfStory: row.selfStory, commitments: row.commitments }),
      state: AgentStateSchema.parse({ mood: row.mood, concerns: row.concerns, relationships: row.relationships }),
      events: eventRows.map((event) => ({ id: event.id, occurredAt: event.occurredAt.toISOString(), summary: event.summary })), memories: memoryRows
    });
    await this.database.db.insert(reflectionRuns).values({ id: reflectionId, agentId, inputStateVersion: input.expectedVersion, status: "pending", input }).onConflictDoNothing({ target: reflectionRuns.id });
    const stored = await this.database.db.select({ input: reflectionRuns.input }).from(reflectionRuns).where(and(eq(reflectionRuns.id, reflectionId), eq(reflectionRuns.agentId, agentId))).limit(1);
    return stored[0] === undefined ? undefined : ReflectionInputSchema.parse(stored[0].input);
  }

  /**
   * A Session is deliberately refreshed after each committed target.  This is
   * not a new selection window: its Event window stays fixed, while later
   * Reflectors can ground their changes in the Memory/State just committed by
   * an earlier target in the same Session.
   */
  async refresh(input: ReflectionInput): Promise<ReflectionInput> {
    const [state, memoryRows] = await Promise.all([this.#state(input.agentId), this.#memories(input.agentId)]);
    if (state === undefined) throw new DomainError("NOT_FOUND", "Agent State was not found");
    return ReflectionInputSchema.parse({
      reflectionId: input.reflectionId,
      agentId: input.agentId,
      ...(input.eventWindowEnd === undefined ? {} : { eventWindowEnd: input.eventWindowEnd }),
      expectedVersion: state.version,
      self: PersistedSelfSchema.parse({ identity: state.identity, disposition: state.disposition, selfStory: state.selfStory, commitments: state.commitments }),
      state: AgentStateSchema.parse({ mood: state.mood, concerns: state.concerns, relationships: state.relationships }),
      events: input.events,
      ...(input.reconciliationAnchors === undefined ? {} : { reconciliationAnchors: input.reconciliationAnchors }),
      ...(input.targetSnapshots === undefined ? {} : { targetSnapshots: input.targetSnapshots }),
      memories: memoryRows
    });
  }

  async reconciliationInput(input: ReflectionInput): Promise<ReflectionInput> {
    if (input.reconciliationAnchors !== undefined) {
      const completed = await this.database.db.select({ anchorMemoryId: reflectionResolutions.anchorMemoryId }).from(reflectionResolutions).where(and(eq(reflectionResolutions.reflectionId, input.reflectionId), eq(reflectionResolutions.target, "reconciliation"), isNotNull(reflectionResolutions.anchorMemoryId), inArray(reflectionResolutions.outcome, ["committed", "no-op"])));
      const completedIds = new Set(completed.flatMap(({ anchorMemoryId }) => anchorMemoryId === null ? [] : [anchorMemoryId]));
      return ReflectionInputSchema.parse({ ...input, memories: input.reconciliationAnchors.filter(({ id }) => !completedIds.has(id)) });
    }
    // One newest eligible Memory per reason keeps the pass bounded while the
    // recorded reason makes the selection auditable in reflection_attempts.
    const rows = await this.pool.query<MemoryRow & { reason: ReactivationCandidate["reason"] }>(`WITH memory_pool AS (
      SELECT * FROM memories m WHERE m.agent_id=$1
        -- Reconciliation may only revise non-episodic Memory from known
        -- later experience.  Do not ask the Reflector to decide an update
        -- which the commit layer must reject for lack of temporal evidence.
        AND m.kind <> 'episodic'
        AND EXISTS (
          SELECT 1 FROM events e
          WHERE e.agent_id=m.agent_id AND e.status='completed'
            AND e.occurred_at>m.occurred_at
            AND e.occurred_at<=COALESCE($3::timestamptz,now())
        )
        -- Formation has just evaluated these Memories from this Session's
        -- fixed Event window.  They cannot yet have later evidence, so they
        -- are not eligible for immediate Reconciliation.
        AND NOT EXISTS (
          SELECT 1 FROM memory_mutations formed
          WHERE formed.agent_id=m.agent_id AND formed.memory_id=m.id
            AND formed.source_event_id LIKE $2
        )
        -- A completed/no-op anchor is durable session progress.  A retry
        -- resumes only anchors that have not yet reached a resolution.
        AND NOT EXISTS (
          SELECT 1 FROM reflection_resolutions resolution
          WHERE resolution.reflection_id=$4 AND resolution.anchor_memory_id=m.id
            AND resolution.target='reconciliation'
            AND resolution.outcome IN ('committed','no-op')
        )
      ORDER BY updated_at DESC,id DESC LIMIT 64
    ), candidates AS (
      SELECT m.*, 'formation'::text AS reason FROM memory_pool m JOIN memory_mutations mm ON mm.memory_id=m.id
        WHERE m.agent_id=$1 AND mm.agent_id=$1 AND mm.operation='create' AND mm.created_at >= now()-interval '30 days'
      UNION ALL
      SELECT m.*, 'concern'::text AS reason FROM memory_pool m JOIN concern_activities ca ON m.id=ANY(ARRAY(SELECT jsonb_array_elements_text(ca.evidence_memory_ids)))
        JOIN concerns c ON c.id=ca.concern_id WHERE m.agent_id=$1 AND c.agent_id=$1
      UNION ALL
      SELECT m.*, 'unreviewed'::text AS reason FROM memory_pool m WHERE NOT EXISTS (SELECT 1 FROM memory_mutations mm WHERE mm.memory_id=m.id AND mm.source_event_id LIKE 'reflection:%:reconciliation%')
      UNION ALL
      SELECT m.*, 'distant'::text AS reason FROM memory_pool m
    ), ranked AS (SELECT candidates.*, row_number() OVER (PARTITION BY reason ORDER BY CASE WHEN reason='distant' THEN occurred_at END ASC NULLS LAST, CASE WHEN reason<>'distant' THEN occurred_at END DESC NULLS LAST,id) AS row_number FROM candidates)
      SELECT r.id,r.kind,r.content,r.importance,r.occurred_at,r.created_at,r.source_agent_id,r.evidence_event_ids,
        COALESCE(jsonb_agg(ms.subject_id ORDER BY ms.subject_id) FILTER (WHERE ms.subject_id IS NOT NULL),'[]'::jsonb) AS subjects,r.reason
      FROM ranked r LEFT JOIN memory_subjects ms ON ms.memory_id=r.id WHERE r.row_number=1
      GROUP BY r.id,r.kind,r.content,r.importance,r.occurred_at,r.created_at,r.source_agent_id,r.evidence_event_ids,r.reason`, [input.agentId, `${input.reflectionId}:memory:%`, input.eventWindowEnd ?? null, input.reflectionId]);
    const candidates = rows.rows.map((row) => ({ memoryId: row.id, reason: row.reason, occurredAt: row.occurred_at.toISOString() }));
    const chosen = new Set(selectReactivationAnchors(candidates).map(({ memoryId }) => memoryId));
    const byId = new Map(rows.rows.map((row) => [row.id, row]));
    const memories = [...chosen].flatMap((id) => {
      const memory = byId.get(id); if (memory === undefined) return [];
      return [EpisodicMemorySchema.parse({ id: memory.id, summary: memory.content, significance: memory.importance, subjects: memory.subjects, occurredAt: memory.occurred_at.toISOString(), createdAt: memory.created_at.toISOString(), kind: memory.kind, evidenceEventIds: Array.isArray(memory.evidence_event_ids) ? memory.evidence_event_ids : [], ...(memory.source_agent_id === null ? {} : { source: memory.source_agent_id }) })];
    });
    const session = ReflectionInputSchema.parse({ ...input, reconciliationAnchors: memories });
    const run = await this.database.db.select({ input: reflectionRuns.input }).from(reflectionRuns).where(eq(reflectionRuns.id, input.reflectionId)).limit(1);
    const storedInput = typeof run[0]?.input === "object" && run[0].input !== null && !Array.isArray(run[0].input) ? run[0].input : {};
    await this.database.db.update(reflectionRuns).set({ input: { ...storedInput, reconciliationAnchors: memories }, updatedAt: this.now() }).where(eq(reflectionRuns.id, input.reflectionId));
    return ReflectionInputSchema.parse({ ...session, memories });
  }

  async commit(input: ReflectionInput, rawOutput: ReflectionOutput): Promise<"committed" | "duplicate"> {
    const output = ReflectionOutputSchema.parse(rawOutput);
    const reflectionIntents = output.memories.map((memory) => ({ content: memory.summary, reason: memory.significance, evidenceEventIds: input.events.map(({ id: eventId }) => eventId), confidence: "medium" as const, target: "episodic" as const, perspective: memory.subjects.length > 0 ? "user" as const : "self" as const, purpose: memory.subjects.length > 0 ? "user-context" as const : "self-guidance" as const }));
    if (this.memoryUpdateSink !== undefined && reflectionIntents.length > 0) {
      const sinkInput = { agentId: input.agentId, eventId: `${input.reflectionId}:memory-update`, sourceKind: "reflection-formation" as const, sourceId: input.reflectionId, intents: reflectionIntents, subjectsByIntent: output.memories.map((memory) => memory.subjects), sourceAgentIds: output.memories.map((memory) => memory.source) };
      try {
        if (this.memoryUpdateSink.enqueueAndWait !== undefined) await this.memoryUpdateSink.enqueueAndWait(sinkInput);
        else await this.memoryUpdateSink.enqueue(sinkInput);
      } catch (error) {
        const plan = ReflectionPlanSchema.parse({ memory: "failed", reconciliation: "blocked", self: "blocked", relationship: "blocked", concern: "blocked", errors: [{ target: "memory", message: error instanceof Error ? error.message : "MemoryUpdate failed" }] });
        await this.database.db.update(reflectionRuns).set({ status: "pending", plan, failureReason: plan.errors[0]?.message ?? "MemoryUpdate failed", updatedAt: this.now() }).where(and(eq(reflectionRuns.id, input.reflectionId), ne(reflectionRuns.status, "completed")));
        return "committed";
      }
    }
    const embeddingPreparer = this.memoryEmbedding;
    const memoryEmbeddings = this.memoryUpdateSink === undefined && embeddingPreparer !== undefined
      ? await Promise.all(output.memories.map((memory) => embeddingPreparer.prepareMemory(memory.summary)))
      : [];
    return this.database.transaction(async (client) => {
      const run = (await client.select({ status: reflectionRuns.status }).from(reflectionRuns).where(and(eq(reflectionRuns.id, input.reflectionId), eq(reflectionRuns.agentId, input.agentId))).for("update").limit(1))[0];
      if (run?.status === "completed") return "duplicate";
      if (run === undefined) throw new DomainError("NOT_FOUND", "Reflection run was not found");
      const appliedConcerns = concernLifecycle.reconcile(input.state.concerns, output.concernChanges, () => this.ids.next());
      const occurredAt = this.now();
      for (const [index, concern] of input.state.concerns.filter(({ status }) => status === "active").entries()) await client.insert(concernActivities).values({ id: `reflection:${input.reflectionId}:presented:${String(index)}:${concern.id}`, concernId: concern.id, kind: "presented", reflectionId: input.reflectionId, evidenceMemoryIds: [], occurredAt }).onConflictDoNothing({ target: concernActivities.id });
      const closedConcerns = await this.#closeStaleConcerns(client, input.agentId, input.reflectionId, appliedConcerns.concerns, new Set(appliedConcerns.activities.map(({ concernId }) => concernId)), occurredAt);
      const state = AgentStateSchema.parse({ ...input.state, ...(output.mood === undefined ? {} : { mood: output.mood }), concerns: closedConcerns, relationships: applyRelationships(input.state.relationships, output.relationshipChanges) });
      const self = output.self ?? input.self;
      const updated = await client.update(agentStates).set({ disposition: self.disposition, selfStory: self.selfStory, commitments: self.commitments, relationships: state.relationships, mood: state.mood, version: sql`${agentStates.version}+1`, updatedAt: occurredAt }).where(and(eq(agentStates.agentId, input.agentId), eq(agentStates.version, input.expectedVersion))).returning({ version: agentStates.version });
      if (updated.length !== 1) throw new DomainError("CONFLICT", "Reflection state version conflict");
      await new ConcernRepository(client).replace(input.agentId, state.concerns, occurredAt);
      for (const [index, activity] of appliedConcerns.activities.entries()) await client.insert(concernActivities).values({ id: `reflection:${input.reflectionId}:change:${String(index)}:${activity.kind}:${activity.concernId}`, concernId: activity.concernId, kind: activity.kind, reflectionId: input.reflectionId, evidenceMemoryIds: output.evidenceMemoryIds, occurredAt }).onConflictDoNothing({ target: concernActivities.id });
      if (self.identity !== input.self.identity) await client.update(agents).set({ identity: self.identity, updatedAt: occurredAt }).where(eq(agents.id, input.agentId));
      const reflectionCandidates = input.memories.map((memory) => ({ id: memory.id, kind: "episodic", content: memory.summary, importance: memory.significance }));
      if (this.memoryUpdateSink === undefined) {
        for (const [memoryIndex, memory] of output.memories.entries()) {
          await new MemoryWriteService(client, this.ids, this.now).apply(input.agentId, reflectionIntents[memoryIndex] ?? { content: memory.summary, reason: memory.significance, evidenceEventIds: [], confidence: "low", target: "episodic", perspective: memory.subjects.length > 0 ? "user" : "self", purpose: memory.subjects.length > 0 ? "user-context" : "self-guidance" }, { subjectIds: memory.subjects, sourceKind: "reflection-formation", sourceId: input.reflectionId, intentIndex: memoryIndex, candidates: reflectionCandidates, ...(memory.source === undefined ? {} : { sourceAgentId: memory.source }), ...(memoryEmbeddings[memoryIndex] === undefined ? {} : { embedding: memoryEmbeddings[memoryIndex] }) });
        }
      }
      const plan = ReflectionPlanSchema.parse({ memory: "completed", reconciliation: "completed", self: "completed", relationship: "completed", concern: "completed", errors: [] });
      await client.update(reflectionRuns).set({ status: "completed", plan, output, failureReason: null, completedAt: occurredAt, updatedAt: occurredAt }).where(eq(reflectionRuns.id, input.reflectionId));
      return "committed";
    });
  }

  async fail(input: ReflectionInput, error: unknown): Promise<void> {
    await this.database.db.update(reflectionRuns).set({ status: "failed", failureReason: failureReason(error), updatedAt: this.now() }).where(and(eq(reflectionRuns.id, input.reflectionId), ne(reflectionRuns.status, "completed")));
  }

  async #replaceToolExecutions(input: ReflectionInput, target: ReflectionTarget, executions: readonly ToolExecutionRecord[], batchIndex?: number, anchorMemoryId?: string): Promise<void> {
    const nullableEqual = (column: typeof reflectionToolExecutions.batchIndex | typeof reflectionToolExecutions.anchorMemoryId, value: number | string | undefined) => value === undefined ? sql`${column} IS NULL` : eq(column, value as never);
    await this.database.db.delete(reflectionToolExecutions).where(and(eq(reflectionToolExecutions.reflectionId, input.reflectionId), eq(reflectionToolExecutions.target, target), nullableEqual(reflectionToolExecutions.batchIndex, batchIndex), nullableEqual(reflectionToolExecutions.anchorMemoryId, anchorMemoryId)));
    for (const [executionIndex, execution] of executions.entries()) {
      await this.database.db.insert(reflectionToolExecutions).values({ id: `${input.reflectionId}:${target}:${batchIndex === undefined ? "target" : String(batchIndex)}:${anchorMemoryId ?? "none"}:${String(executionIndex)}`, reflectionId: input.reflectionId, target, batchIndex: batchIndex ?? null, anchorMemoryId: anchorMemoryId ?? null, executionIndex, toolCallId: execution.callId, tool: execution.name, input: execution.input, result: execution.ok ? execution.result : null, error: execution.ok ? null : execution.error, startedAt: new Date(execution.startedAt), finishedAt: new Date(execution.finishedAt) });
    }
  }

  async beginTarget(input: ReflectionInput, target: ReflectionTarget): Promise<"pending" | "completed"> {
    const existing = await this.database.db.select({ status: reflectionAttempts.status }).from(reflectionAttempts).where(and(eq(reflectionAttempts.reflectionId, input.reflectionId), eq(reflectionAttempts.target, target))).limit(1);
    if (existing[0]?.status === "completed") return "completed";
    const snapshot = { self: input.self, state: input.state, events: input.events, memories: input.memories };
    const run = await this.database.db.select({ input: reflectionRuns.input }).from(reflectionRuns).where(eq(reflectionRuns.id, input.reflectionId)).limit(1);
    const storedInput = (run[0]?.input ?? {}) as Record<string, unknown>;
    await this.database.db.update(reflectionRuns).set({ input: { ...storedInput, targetSnapshots: { ...((storedInput.targetSnapshots as Record<string, unknown> | undefined) ?? {}), [target]: snapshot } }, updatedAt: this.now() }).where(eq(reflectionRuns.id, input.reflectionId));
    const at = this.now();
    await this.database.db.insert(reflectionAttempts).values({ id: `${input.reflectionId}:${target}`, reflectionId: input.reflectionId, target, status: "pending", input: this.#targetInput(input, target), startedAt: at }).onConflictDoUpdate({ target: [reflectionAttempts.reflectionId, reflectionAttempts.target], set: { status: "pending", failureReason: null, startedAt: at, updatedAt: at } });
    return "pending";
  }

  async memoryBatches(input: ReflectionInput): Promise<readonly ReflectionMemoryBatch[]> {
    const batches = Array.from({ length: Math.ceil(input.events.length / 16) }, (_, batchIndex) => ReflectionMemoryBatchSchema.parse({ batchIndex, events: input.events.slice(batchIndex * 16, (batchIndex + 1) * 16) }));
    for (const batch of batches) await this.database.db.insert(reflectionMemoryBatches).values({ id: `${input.reflectionId}:memory:${String(batch.batchIndex)}`, reflectionId: input.reflectionId, batchIndex: batch.batchIndex, status: "pending", input: { batchIndex: batch.batchIndex, eventIds: batch.events.map(({ id }) => id) } }).onConflictDoNothing({ target: [reflectionMemoryBatches.reflectionId, reflectionMemoryBatches.batchIndex] });
    return batches;
  }

  async beginMemoryBatch(input: ReflectionInput, batch: ReflectionMemoryBatch): Promise<"pending" | "completed"> {
    const existing = await this.database.db.select({ status: reflectionMemoryBatches.status }).from(reflectionMemoryBatches).where(and(eq(reflectionMemoryBatches.reflectionId, input.reflectionId), eq(reflectionMemoryBatches.batchIndex, batch.batchIndex))).limit(1);
    if (existing[0]?.status === "completed") return "completed";
    const at = this.now(); await this.database.db.update(reflectionMemoryBatches).set({ status: "pending", failureReason: null, startedAt: at, updatedAt: at }).where(and(eq(reflectionMemoryBatches.reflectionId, input.reflectionId), eq(reflectionMemoryBatches.batchIndex, batch.batchIndex)));
    return "pending";
  }

  async commitMemoryBatch(input: ReflectionInput, batch: ReflectionMemoryBatch, result: ReflectorResult): Promise<void> {
    await this.#commitMemoryTarget({ ...input, events: batch.events }, MemoryReflectorOutputSchema.parse(result.output), `${input.reflectionId}:memory:${String(batch.batchIndex)}`);
    await this.#replaceToolExecutions(input, "memory", result.toolExecutions, batch.batchIndex);
    const at = this.now(); await this.database.db.update(reflectionMemoryBatches).set({ status: "completed", output: result.output, toolExecutions: null, failureReason: null, completedAt: at, updatedAt: at }).where(and(eq(reflectionMemoryBatches.reflectionId, input.reflectionId), eq(reflectionMemoryBatches.batchIndex, batch.batchIndex)));
  }

  async failMemoryBatch(input: ReflectionInput, batch: ReflectionMemoryBatch, error: unknown): Promise<void> {
    await this.#replaceToolExecutions(input, "memory", toolExecutionsFromFailure(error), batch.batchIndex);
    await this.database.db.update(reflectionMemoryBatches).set({ status: "failed", toolExecutions: null, failureReason: failureReason(error), updatedAt: this.now() }).where(and(eq(reflectionMemoryBatches.reflectionId, input.reflectionId), eq(reflectionMemoryBatches.batchIndex, batch.batchIndex)));
  }

  async completeMemoryTarget(input: ReflectionInput): Promise<void> {
    const batches = await this.database.db.select({ batchIndex: reflectionMemoryBatches.batchIndex, status: reflectionMemoryBatches.status, output: reflectionMemoryBatches.output }).from(reflectionMemoryBatches).where(eq(reflectionMemoryBatches.reflectionId, input.reflectionId)).orderBy(reflectionMemoryBatches.batchIndex);
    if (batches.length === 0 || batches.some(({ status }) => status !== "completed")) throw new DomainError("CONFLICT", "Reflection Memory batches are not all completed");
    const at = this.now(); await this.database.db.update(reflectionAttempts).set({ status: "completed", output: { batches: batches.map(({ batchIndex, output }) => ({ batchIndex, output })) }, toolExecutions: null, failureReason: null, completedAt: at, updatedAt: at }).where(and(eq(reflectionAttempts.reflectionId, input.reflectionId), eq(reflectionAttempts.target, "memory")));
  }

  async commitTarget(input: ReflectionInput, target: ReflectionTarget, result: ReflectorResult): Promise<void> {
    if (target === "memory") await this.#commitMemoryTarget(input, MemoryReflectorOutputSchema.parse(result.output));
    if (target === "reconciliation") await this.#commitReconciliationTarget(input, MemoryReconciliationOutputSchema.parse(result.output));
    if (target === "concern") await this.#commitConcernTarget(input, ConcernReflectorOutputSchema.parse(result.output));
    if (target === "relationship") await this.#commitRelationshipTarget(input, RelationshipReflectorOutputSchema.parse(result.output));
    if (target === "self-mood") await this.#commitSelfMoodTarget(input, SelfMoodReflectorOutputSchema.parse(result.output));
    const anchorMemoryId = target === "reconciliation" ? input.memories[0]?.id : undefined;
    await this.#replaceToolExecutions(input, target, result.toolExecutions, undefined, anchorMemoryId);
    const status = target === "reconciliation" ? "pending" : "completed"; const at = this.now();
    await this.database.db.update(reflectionAttempts).set({ status, output: result.output, toolExecutions: null, failureReason: null, completedAt: status === "completed" ? at : null, updatedAt: at }).where(and(eq(reflectionAttempts.reflectionId, input.reflectionId), eq(reflectionAttempts.target, target)));
  }

  async completeTarget(input: ReflectionInput, target: ReflectionTarget): Promise<void> {
    const at = this.now(); await this.database.db.update(reflectionAttempts).set({ status: "completed", toolExecutions: null, failureReason: null, completedAt: at, updatedAt: at }).where(and(eq(reflectionAttempts.reflectionId, input.reflectionId), eq(reflectionAttempts.target, target)));
  }

  async failTarget(input: ReflectionInput, target: ReflectionTarget, error: unknown): Promise<void> {
    const anchorMemoryId = target === "reconciliation" ? input.memories[0]?.id : undefined;
    if (target !== "memory") await this.#replaceToolExecutions(input, target, toolExecutionsFromFailure(error), undefined, anchorMemoryId);
    await this.database.db.update(reflectionAttempts).set({ status: "failed", toolExecutions: null, failureReason: failureReason(error), updatedAt: this.now() }).where(and(eq(reflectionAttempts.reflectionId, input.reflectionId), eq(reflectionAttempts.target, target)));
  }

  async blockTarget(input: ReflectionInput, target: ReflectionTarget): Promise<void> {
    const at = this.now(); await this.database.db.insert(reflectionAttempts).values({ id: `${input.reflectionId}:${target}`, reflectionId: input.reflectionId, target, status: "blocked", input: this.#targetInput(input, target), completedAt: at }).onConflictDoUpdate({ target: [reflectionAttempts.reflectionId, reflectionAttempts.target], set: { status: "blocked", updatedAt: at } });
  }

  async complete(input: ReflectionInput): Promise<void> {
    const rows = await this.database.db.select({ target: reflectionAttempts.target, status: reflectionAttempts.status, failureReason: reflectionAttempts.failureReason }).from(reflectionAttempts).where(eq(reflectionAttempts.reflectionId, input.reflectionId)).orderBy(reflectionAttempts.target);
    const attempts = new Map(rows.map((row) => [row.target, row]));
    const plan = ReflectionPlanSchema.parse({
      memory: attempts.get("memory")?.status ?? "pending",
      reconciliation: attempts.get("reconciliation")?.status ?? "pending",
      concern: attempts.get("concern")?.status ?? "pending",
      relationship: attempts.get("relationship")?.status ?? "pending",
      self: attempts.get("self-mood")?.status ?? "pending",
      errors: rows.filter((row) => row.status === "failed" && row.failureReason !== null).map((row) => ({ target: row.target === "self-mood" ? "self" : row.target, message: row.failureReason ?? "Reflection target failed" }))
    });
    const retryable = rows.some((row) => row.status === "failed" || row.status === "blocked");
    try {
      if (attempts.get("concern")?.status === "completed") {
        const state = await this.database.db.select({ relationships: agentStates.relationships, version: agentStates.version }).from(agentStates).where(eq(agentStates.agentId, input.agentId)).limit(1);
        const current = state[0];
        if (current !== undefined) {
          const activity = await this.database.db.selectDistinct({ concernId: concernActivities.concernId }).from(concernActivities).innerJoin(concernRecords, eq(concernRecords.id, concernActivities.concernId)).where(and(eq(concernRecords.agentId, input.agentId), eq(concernActivities.reflectionId, input.reflectionId), ne(concernActivities.kind, "presented")));
          const parsed = AgentStateSchema.parse({ concerns: await new ConcernRepository(this.database.db).list(input.agentId), relationships: current.relationships });
          await this.database.transaction(async (client) => {
            const closed = await this.#closeStaleConcerns(client, input.agentId, input.reflectionId, parsed.concerns, new Set(activity.map(({ concernId }) => concernId)), this.now());
            if (JSON.stringify(closed) !== JSON.stringify(parsed.concerns)) {
              const at = this.now();
              const changed = await client.update(agentStates).set({ version: sql`${agentStates.version}+1`, updatedAt: at }).where(and(eq(agentStates.agentId, input.agentId), eq(agentStates.version, current.version))).returning({ version: agentStates.version });
              if (changed.length !== 1) throw new DomainError("CONFLICT", "Reflection Concern stale-close state version conflict");
              await new ConcernRepository(client).replace(input.agentId, closed, at);
            }
          });
        }
      }
    } catch (error) {
      if (!(error instanceof DomainError) || error.code !== "CONFLICT") throw error;
      const failureReason = "Reflection has retryable target failures";
      const retryPlan = ReflectionPlanSchema.parse({ ...plan, errors: [...plan.errors, { target: "concern", message: error.message }] });
      await this.database.db.update(reflectionRuns).set({ status: "pending", plan: retryPlan, failureReason, completedAt: null, updatedAt: this.now() }).where(eq(reflectionRuns.id, input.reflectionId));
      throw new DomainError("EXTERNAL", failureReason, { cause: error });
    }
    const retryFailureReason = "Reflection has retryable target failures";
    const status = retryable ? "pending" : "completed"; const at = this.now(); await this.database.db.update(reflectionRuns).set({ status, plan, failureReason: retryable ? retryFailureReason : null, completedAt: status === "completed" ? at : null, updatedAt: at }).where(eq(reflectionRuns.id, input.reflectionId));
    if (retryable) throw new DomainError("EXTERNAL", retryFailureReason);
  }

  #targetInput(input: ReflectionInput, target: ReflectionTarget): unknown {
    // Memory batch inputs are persisted in reflection_memory_batches.  Keeping
    // only their count here prevents a maintenance-attempt audit row from
    // accidentally becoming a second, unbounded model input.
    if (target === "memory") return { target, eventIds: input.events.map(({ id }) => id), batchCount: Math.ceil(input.events.length / 16) };
    if (target === "reconciliation") return { target, anchorMemoryIds: input.memories.map(({ id }) => id) };
    if (target === "concern") {
      const context = reflectionConcernContext(input, this.now());
      return { target, concernIds: input.state.concerns.map(({ id }) => id), memoryIds: input.memories.map(({ id }) => id), concernContext: context.stats };
    }
    if (target === "relationship") return { target, eventIds: input.events.slice(-32).map(({ id }) => id), memoryIds: input.memories.map(({ id }) => id), subjectIds: input.state.relationships.map(({ subjectId }) => subjectId) };
    return { target, memoryIds: input.memories.map(({ id }) => id) };
  }

  async #commitConcernTarget(input: ReflectionInput, output: z.infer<typeof ConcernReflectorOutputSchema>): Promise<void> {
    await this.database.transaction(async (client) => {
      const state = await client.select({ version: agentStates.version }).from(agentStates).where(eq(agentStates.agentId, input.agentId)).limit(1);
      const row = state[0]; if (row === undefined) throw new DomainError("NOT_FOUND", "Agent State was not found");
      const repository = new ConcernRepository(client);
      const current = await repository.list(input.agentId);
      const byDescription = new Map(current.map((concern) => [concern.description, concern]));
      const changes: ConcernChange[] = output.concernChanges.flatMap<ConcernChange>((change) => {
        const previous = byDescription.get(change.currentDescription);
        if (previous === undefined) return [];
        if (change.operation === "remove") return [{ operation: "remove" as const, id: previous.id }];
        return [{ operation: "upsert" as const, concern: { id: previous.id, description: change.description, whyItMatters: change.whyItMatters, status: change.status } }];
      });
      const applied = concernLifecycle.reconcile(current, changes, () => this.ids.next());
      const at = this.now();
      const updated = await client.update(agentStates).set({ version: sql`${agentStates.version}+1`, updatedAt: at }).where(and(eq(agentStates.agentId, input.agentId), eq(agentStates.version, row.version))).returning({ version: agentStates.version });
      if (updated.length !== 1) throw new DomainError("CONFLICT", "Reflection Concern state version conflict");
      await repository.replace(input.agentId, applied.concerns, at);
      // Every active Concern was presented to this successful Reflection Session.
      for (const [index, concern] of applied.concerns.filter(({ status }) => status === "active").entries()) await client.insert(concernActivities).values({ id: `reflection:${input.reflectionId}:target-concern:presented:${String(index)}:${concern.id}`, concernId: concern.id, kind: "presented", reflectionId: input.reflectionId, evidenceMemoryIds: [], occurredAt: at }).onConflictDoNothing({ target: concernActivities.id });
      for (const [index, activity] of applied.activities.entries()) await client.insert(concernActivities).values({ id: `reflection:${input.reflectionId}:target-concern:${String(index)}:${activity.kind}:${activity.concernId}`, concernId: activity.concernId, kind: activity.kind, reflectionId: input.reflectionId, evidenceMemoryIds: [], occurredAt: at }).onConflictDoNothing({ target: concernActivities.id });
    });
  }

  /**
   * Formation has a fixed Event window.  The model describes an experience in
   * natural language; this runtime resolver ranks only projections inside that
   * window using keyword and, when available, vector evidence.  It is the
   * ownership boundary which prevents model-emitted IDs from becoming writes.
   */
  async #resolveFormationEvidence(input: ReflectionInput, memory: z.infer<typeof MemoryReflectorOutputSchema>["memories"][number]): Promise<{ readonly evidenceEventIds: readonly string[]; readonly subjectIds: readonly string[]; readonly score: Readonly<Record<string, { readonly score: number; readonly keyword: number; readonly semantic: number }>> }> {
    const query = `${memory.content} ${memory.reason}`;
    const embedding = this.memoryEmbedding === undefined ? undefined : await this.memoryEmbedding.prepareMemory(query);
    const vector = embedding?.status === "ready" && embedding.vector !== undefined ? `[${embedding.vector.join(",")}]` : null;
    const projections = await this.pool.query<EventProjectionRow>(`SELECT ep.event_id AS id,x.summary || ' ' || x.facts::text AS content,
        COALESCE((SELECT jsonb_agg(es.subject_id ORDER BY es.subject_id) FROM event_subjects es WHERE es.event_id=ep.event_id),'[]'::jsonb) AS subjects,e.occurred_at,
        CASE WHEN $3::vector IS NULL OR ep.embedding IS NULL THEN NULL ELSE 1-(ep.embedding <=> $3::vector) END AS vector_score
      FROM event_projections ep JOIN event_experiences x ON x.event_id=ep.event_id JOIN events e ON e.id=ep.event_id
      WHERE e.agent_id=$1 AND ep.event_id=ANY($2::text[])
      ORDER BY e.occurred_at DESC,ep.event_id DESC`, [input.agentId, input.events.map(({ id }) => id), vector]);
    const byId = new Map(projections.rows.map((row) => [row.id, row]));
    const terms = formationTerms(query);
    const ranked = input.events.map((event) => {
      const projection = byId.get(event.id);
      const content = projection?.content ?? event.summary;
      const keyword = scoreKeyword(terms, content);
      const semantic = projection?.vector_score ?? 0;
      // A vector hit and a lexical hit are complementary: either can support
      // a candidate, while agreement raises its ranking.  Recency breaks ties
      // deterministically inside the fixed window.
      const score = semantic > 0 && keyword > 0 ? semantic * 0.55 + keyword * 0.45 : Math.max(semantic, keyword);
      return { event, projection, score, keyword, semantic };
    }).filter(({ score }) => score >= formationMinimumScore).sort((left, right) => right.score - left.score || right.event.occurredAt.localeCompare(left.event.occurredAt) || left.event.id.localeCompare(right.event.id)).slice(0, 16);
    const subjectIds = [...new Set(ranked.flatMap(({ projection }) => Array.isArray(projection?.subjects) ? projection.subjects.filter((subject): subject is string => typeof subject === "string") : []))];
    return {
      evidenceEventIds: ranked.map(({ event }) => event.id),
      subjectIds,
      score: Object.fromEntries(ranked.map(({ event, score, keyword, semantic }) => [event.id, { score, keyword, semantic }]))
    };
  }

  async #commitMemoryTarget(input: ReflectionInput, output: z.infer<typeof MemoryReflectorOutputSchema>, sourceEventId = input.reflectionId): Promise<void> {
    const candidates = await Promise.all(output.memories.map(async (memory) => ({ memory, ...(await this.#resolveFormationEvidence(input, memory)) })));
    const resolved = candidates.filter(({ evidenceEventIds }) => evidenceEventIds.length > 0);
    const rejected = candidates.filter(({ evidenceEventIds }) => evidenceEventIds.length === 0).map(({ memory }) => ({ reason: "unsupported-by-fixed-event-window", content: memory.content.slice(0, 240) }));
    const batchIndex = /^.+:memory:(\d+)$/.exec(sourceEventId)?.[1];
    await this.database.db.insert(reflectionResolutions).values({ id: this.ids.next(), reflectionId: input.reflectionId, target: "formation", batchIndex: batchIndex === undefined ? null : Number(batchIndex), resolverVersion: formationResolverVersion, querySummary: output.memories.map(({ content }) => content.slice(0, 120)).join(" / "), candidateCount: output.memories.length, selectedEventIds: [...new Set(resolved.flatMap(({ evidenceEventIds }) => evidenceEventIds))], rejected, score: resolved.map(({ memory, score }) => ({ content: memory.content.slice(0, 120), score })), temporalDecision: "fixed-window-hybrid", outcome: resolved.length === 0 ? "no-op" : "committed" });
    const intents = resolved.map(({ memory, evidenceEventIds }) => ({ content: memory.content, reason: memory.reason, evidenceEventIds: [...evidenceEventIds], confidence: "medium" as const, target: memory.target, perspective: memory.perspective, purpose: memory.perspective === "user" ? "user-context" as const : "self-guidance" as const }));
    if (this.memoryUpdateSink !== undefined && intents.length > 0) {
      const sinkInput = { agentId: input.agentId, eventId: `${sourceEventId}:update`, sourceKind: "reflection-formation" as const, sourceId: sourceEventId, intents, subjectsByIntent: resolved.map(({ subjectIds }) => subjectIds), formation: true };
      if (this.memoryUpdateSink.enqueueAndWait !== undefined) await this.memoryUpdateSink.enqueueAndWait(sinkInput); else await this.memoryUpdateSink.enqueue(sinkInput);
      return;
    }
    const embeddingPreparer = this.memoryEmbedding;
    const embeddings = embeddingPreparer === undefined ? [] : await Promise.all(resolved.map(({ memory }) => embeddingPreparer.prepareMemory(memory.content)));
    let failedIntent: (typeof intents)[number] | undefined;
    let failedOptions: Parameters<MemoryWriteService["apply"]>[2] | undefined;
    try {
      await this.database.transaction(async (client) => {
        for (const [index, { subjectIds }] of resolved.entries()) {
          const intent = intents[index]; if (intent === undefined) throw new DomainError("VALIDATION", "Reflection Memory intent was not created");
          const options = { subjectIds, sourceKind: "reflection-formation" as const, sourceId: sourceEventId, intentIndex: index, candidates: [], ...(embeddings[index] === undefined ? {} : { embedding: embeddings[index] }) };
          failedIntent = intent; failedOptions = options;
          await new MemoryWriteService(client, this.ids, this.now).apply(input.agentId, intent, options);
          failedIntent = undefined; failedOptions = undefined;
        }
      });
    } catch (error) {
      if (failedIntent !== undefined && failedOptions !== undefined) await recordMemoryMutationFailure(this.pool, input.agentId, failedIntent, failedOptions, error, this.now());
      throw error;
    }
  }

  async #commitReconciliationTarget(input: ReflectionInput, output: z.infer<typeof MemoryReconciliationOutputSchema>): Promise<void> {
    const anchor = input.memories[0];
    if (anchor === undefined || input.memories.length !== 1) throw new DomainError("VALIDATION", "Reconciliation requires exactly one Runtime-bound anchor");
    let failedChange: z.infer<typeof MemoryReconciliationOutputSchema>["changes"][number] | undefined; let failedIndex: number | undefined;
    try {
      await this.database.transaction(async (client) => {
        for (const [index, change] of output.changes.entries()) {
          failedChange = change; failedIndex = index;
          if (change.operation !== "keep" && anchor.kind === "episodic") throw new DomainError("VALIDATION", "Episodic Memory cannot be changed");
          const evidence = await client.select({ id: events.id }).from(events).leftJoin(observationGateDecisions, eq(observationGateDecisions.eventId, events.id)).where(and(eq(events.agentId, input.agentId), eq(events.status, "completed"), sql`coalesce(${observationGateDecisions.decision}, 'engage') <> 'ignore'`, gt(events.occurredAt, new Date(anchor.occurredAt)), input.eventWindowEnd === undefined ? undefined : lte(events.occurredAt, new Date(input.eventWindowEnd)))).orderBy(asc(events.occurredAt), asc(events.id)).limit(16);
          if (change.operation !== "keep" && evidence.length === 0) throw new DomainError("VALIDATION", "Memory Reconciliation can only update from known later Events");
          await new MemoryWriteService(client, this.ids, this.now).reconcile(input.agentId, { ...change, memoryId: anchor.id, evidenceEventIds: evidence.map(({ id }) => id) }, { sourceKind: "reflection-reconciliation", sourceId: input.reflectionId, intentIndex: index });
          await client.insert(reflectionResolutions).values({ id: this.ids.next(), reflectionId: input.reflectionId, target: "reconciliation", anchorMemoryId: anchor.id, resolverVersion: "reconciliation-v1", querySummary: anchor.summary.slice(0, 240), candidateCount: evidence.length, selectedEventIds: evidence.map(({ id }) => id), rejected: [], score: { operation: change.operation }, temporalDecision: "later-events-only", outcome: change.operation === "keep" ? "no-op" : "committed" });
          failedChange = undefined; failedIndex = undefined;
        }
      });
    } catch (error) { if (failedChange !== undefined && failedIndex !== undefined) await recordMemoryMutationFailure(this.pool, input.agentId, failedChange, { sourceKind: "reflection-reconciliation", sourceId: input.reflectionId, intentIndex: failedIndex }, error, this.now()); throw error; }
  }

  async #commitRelationshipTarget(input: ReflectionInput, output: z.infer<typeof RelationshipReflectorOutputSchema>): Promise<void> {
    const state = await this.database.db.select({ relationships: agentStates.relationships, version: agentStates.version }).from(agentStates).where(eq(agentStates.agentId, input.agentId)).limit(1);
    const row = state[0]; if (row === undefined) throw new DomainError("NOT_FOUND", "Agent State was not found");
    const current = AgentStateSchema.parse({ concerns: [], relationships: row.relationships }).relationships;
    const changes: RelationshipChange[] = output.relationshipChanges.flatMap<RelationshipChange>((change) => {
      const matches = current.filter((relationship) => relationship.description === change.currentDescription && (relationship.subjectId === userMainSubjectId || relationship.subjectId.startsWith("agent:")));
      const previous = matches.length === 1 ? matches[0] : undefined;
      if (previous === undefined) return [];
      return change.operation === "remove"
        ? [{ operation: "remove" as const, subjectId: previous.subjectId }]
        : [{ operation: "upsert" as const, relationship: { subjectId: previous.subjectId, description: change.description } }];
    });
    const relationships = applyRelationships(current, changes);
    const updated = await this.database.db.update(agentStates).set({ relationships, version: sql`${agentStates.version}+1`, updatedAt: this.now() }).where(and(eq(agentStates.agentId, input.agentId), eq(agentStates.version, row.version))).returning({ version: agentStates.version });
    if (updated.length !== 1) throw new DomainError("CONFLICT", "Reflection Relationship state version conflict");
  }

  async #commitSelfMoodTarget(input: ReflectionInput, output: z.infer<typeof SelfMoodReflectorOutputSchema>): Promise<void> {
    const state = await this.database.db.select({ disposition: agentStates.disposition, selfStory: agentStates.selfStory, commitments: agentStates.commitments, mood: agentStates.mood, version: agentStates.version }).from(agentStates).where(eq(agentStates.agentId, input.agentId)).limit(1);
    const row = state[0]; if (row === undefined) throw new DomainError("NOT_FOUND", "Agent State was not found");
    const self = output.self;
    const updated = await this.database.db.update(agentStates).set({ disposition: self?.disposition ?? row.disposition, selfStory: self?.selfStory ?? row.selfStory, commitments: self?.commitments ?? row.commitments, mood: output.mood ?? row.mood, version: sql`${agentStates.version}+1`, updatedAt: this.now() }).where(and(eq(agentStates.agentId, input.agentId), eq(agentStates.version, row.version))).returning({ version: agentStates.version });
    if (updated.length !== 1) throw new DomainError("CONFLICT", "Reflection Self/Mood state version conflict");
    if (self !== undefined) await this.database.db.update(agents).set({ identity: self.identity, updatedAt: this.now() }).where(eq(agents.id, input.agentId));
  }

  async #closeStaleConcerns(client: ReflectionTransaction, agentId: string, reflectionId: string, concerns: readonly Concern[], changedConcernIds: ReadonlySet<string>, now: Date): Promise<readonly Concern[]> {
    const next = [...concerns];
    for (const [index, concern] of concerns.entries()) {
      if (concern.status !== "active" || changedConcernIds.has(concern.id)) continue;
      const lastMeaningful = (await client.select({ occurredAt: concernActivities.occurredAt }).from(concernActivities).innerJoin(concernRecords, eq(concernRecords.id, concernActivities.concernId)).where(and(eq(concernRecords.agentId, agentId), eq(concernActivities.concernId, concern.id), inArray(concernActivities.kind, ["baseline", "created", "derived", "reviewed", "focused", "progressed", "status-changed"]))).orderBy(desc(concernActivities.occurredAt)).limit(1))[0]?.occurredAt;
      if (lastMeaningful === undefined) continue;
      if (now.getTime() - lastMeaningful.getTime() < this.concernLifecycle.staleAfterMs) continue;
      const presentations = await client.select({ reflectionId: concernActivities.reflectionId }).from(concernActivities).innerJoin(concernRecords, eq(concernRecords.id, concernActivities.concernId)).where(and(eq(concernRecords.agentId, agentId), eq(concernActivities.concernId, concern.id), eq(concernActivities.kind, "presented"), isNotNull(concernActivities.reflectionId), gte(concernActivities.occurredAt, lastMeaningful)));
      const reflectionIds = [...new Set(presentations.flatMap(({ reflectionId: activityReflectionId }) => activityReflectionId === null ? [] : [activityReflectionId]))];
      const sessions = reflectionIds.length === 0 ? [] : await client.select({ id: reflectionRuns.id }).from(reflectionRuns).where(and(eq(reflectionRuns.agentId, agentId), inArray(reflectionRuns.id, reflectionIds), sql`(${reflectionRuns.status} = 'completed' OR ${reflectionRuns.id} = ${reflectionId})`));
      if (sessions.length < this.concernLifecycle.minReflectionSessions) continue;
      next[index] = { ...concern, status: "abandoned" };
      for (const kind of ["status-changed", "closed"] as const) await client.insert(concernActivities).values({ id: `reflection:${reflectionId}:close:${String(index)}:${kind}:${concern.id}`, concernId: concern.id, kind, reflectionId, evidenceMemoryIds: [], occurredAt: now }).onConflictDoNothing({ target: concernActivities.id });
    }
    return next;
  }
}
