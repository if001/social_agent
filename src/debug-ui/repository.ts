import type { QueryResultRow } from "pg";
import type { RuntimeDatabase } from "../infrastructure/persistence/runtime-database.js";
import { concernLifecycleHealth } from "./concern-lifecycle-health.js";

export type SqlQuery = <T extends QueryResultRow>(sql: string, values?: readonly unknown[]) => Promise<readonly T[]>;

export type AgentListItem = { readonly id: string; readonly identity: string; readonly familyId: string; readonly active: boolean; readonly stateUpdatedAt: Date | null };

export type AgentOverview = {
  readonly agent: Record<string, unknown>;
  readonly state: Record<string, unknown>;
  readonly scheduledTasks: readonly Record<string, unknown>[];
  readonly schedules: readonly Record<string, unknown>[];
  readonly reflections: readonly Record<string, unknown>[];
  readonly reflectionAttempts: readonly Record<string, unknown>[];
  readonly reflectionMemoryBatches: readonly Record<string, unknown>[];
  /** Runtime-owned evidence resolution audit.  This is intentionally an
   * audit projection, not model reasoning or prompt text. */
  readonly reflectionResolutions: readonly Record<string, unknown>[];
  readonly concernActivities: readonly Record<string, unknown>[];
  readonly concernReevaluationBatches: readonly Record<string, unknown>[];
  readonly concernLifecycle: Record<string, unknown>;
  readonly conversations: readonly Record<string, unknown>[];
};

export type RunListItem = {
  readonly id: string;
  readonly eventId: string;
  readonly eventKind: string;
  readonly internalKind: string | null;
  readonly eventSummary: unknown;
  readonly startedAt: Date;
  readonly finishedAt: Date | null;
  readonly failureReason: string | null;
  readonly result: unknown;
};

export type RunDetail = {
  readonly run: Record<string, unknown>;
  readonly stateChanges: readonly Record<string, unknown>[];
  readonly toolExecutions: readonly Record<string, unknown>[];
  readonly concernActivities: readonly Record<string, unknown>[];
};

export type EventListItem = {
  readonly id: string;
  /** Agent that owns and processes this Event. */
  readonly agentId: string;
  readonly kind: string;
  readonly internalKind: string | null;
  readonly observation: unknown;
  readonly source: string;
  readonly causationId: string | null;
  readonly correlationId: string | null;
  readonly status: string;
  readonly occurredAt: Date;
  readonly runId: string | null;
  readonly startedAt: Date | null;
  readonly finishedAt: Date | null;
  readonly failureReason: string | null;
  readonly result: unknown;
  readonly observationGate: Record<string, unknown> | null;
};

export type EventTrace = {
  readonly event: Record<string, unknown>;
  readonly run: Record<string, unknown> | undefined;
  readonly stateChanges: readonly Record<string, unknown>[];
  readonly toolExecutions: readonly Record<string, unknown>[];
  readonly memoryMutations: readonly Record<string, unknown>[];
  readonly predictions: readonly Record<string, unknown>[];
  readonly predictionEvaluations: readonly Record<string, unknown>[];
  readonly g3Tasks: readonly Record<string, unknown>[];
  readonly experienceIntegrations: readonly Record<string, unknown>[];
  readonly scheduledTasks: readonly Record<string, unknown>[];
  readonly outbox: readonly Record<string, unknown>[];
  readonly derivedEvents: readonly Record<string, unknown>[];
  readonly concernActivities: readonly Record<string, unknown>[];
  readonly observationGate: Record<string, unknown> | undefined;
};

export class DebugUiRepository {
  constructor(private readonly query: SqlQuery) {}

  static fromDatabase(database: RuntimeDatabase): DebugUiRepository {
    // Debug projections intentionally use repository-owned SQL for JSON-path,
    // lateral latest-Run selection, and multi-ledger trace composition. The
    // UI entry point receives no pg client and cannot issue arbitrary queries.
    return new DebugUiRepository(async <T extends QueryResultRow>(statement: string, values: readonly unknown[] = []) => (await database.native.query<T>(statement, [...values])).rows);
  }

  async listAgents(): Promise<readonly AgentListItem[]> {
    return this.query<AgentListItem & QueryResultRow>(`SELECT a.id,a.identity,a.family_id AS "familyId",a.active,s.updated_at AS "stateUpdatedAt"
      FROM agents a LEFT JOIN agent_states s ON s.agent_id=a.id ORDER BY a.id`);
  }

  async getOverview(agentId: string): Promise<AgentOverview | undefined> {
    const agents = await this.query<QueryResultRow>(`SELECT a.id,a.identity,a.family_id AS "familyId",a.initial_disposition AS "initialDisposition",a.active,
      f.name AS "familyName",f.shared_disposition AS "sharedDisposition",
      s.disposition,s.self_story AS "selfStory",s.commitments
      FROM agents a JOIN agent_families f ON f.id=a.family_id LEFT JOIN agent_states s ON s.agent_id=a.id WHERE a.id=$1`, [agentId]);
    const agent = agents[0];
    if (agent === undefined) return undefined;
    const [states, currentConcerns, scheduledTasks, schedules, reflections, rawReflectionAttempts, rawReflectionMemoryBatches, reflectionToolExecutions, reflectionResolutions, concernActivities, concernReevaluationBatches, conversations, lifecycleTotals, dormantConcerns, similarConcerns] = await Promise.all([
      this.query<QueryResultRow>(`SELECT mood,relationships,version,updated_at AS "updatedAt" FROM agent_states WHERE agent_id=$1`, [agentId]),
      this.query<QueryResultRow>(`SELECT id,description,why_it_matters AS "whyItMatters",status,version,created_at AS "createdAt",updated_at AS "updatedAt" FROM concerns WHERE agent_id=$1 AND deleted_at IS NULL ORDER BY created_at,id`, [agentId]),
      this.query<QueryResultRow>(`SELECT id,execute_at AS "executeAt",instruction,reason,destination,status,attempt,source_event_id AS "sourceEventId",source_run_id AS "sourceRunId",execution_event_id AS "executionEventId",failure_reason AS "failureReason",updated_at AS "updatedAt" FROM scheduled_tasks WHERE agent_id=$1 ORDER BY execute_at DESC,id LIMIT 100`, [agentId]),
      this.query<QueryResultRow>(`SELECT id,kind,reason,next_due_at AS "nextDueAt",lease_until AS "leaseUntil",updated_at AS "updatedAt" FROM autonomous_schedules WHERE agent_id=$1 ORDER BY next_due_at,id LIMIT 100`, [agentId]),
      this.query<QueryResultRow>(`SELECT id,input_state_version AS "inputStateVersion",status,input,output,failure_reason AS "failureReason",completed_at AS "completedAt",created_at AS "createdAt",updated_at AS "updatedAt" FROM reflection_runs WHERE agent_id=$1 ORDER BY created_at DESC,id LIMIT 50`, [agentId]),
      this.query<QueryResultRow>(`SELECT a.id,a.reflection_id AS "reflectionId",a.target,a.status,a.input,a.output,a.failure_reason AS "failureReason",a.started_at AS "startedAt",a.completed_at AS "completedAt",a.updated_at AS "updatedAt" FROM reflection_attempts a JOIN reflection_runs r ON r.id=a.reflection_id WHERE r.agent_id=$1 ORDER BY a.updated_at DESC,a.id LIMIT 200`, [agentId]),
      this.query<QueryResultRow>(`SELECT b.id,b.reflection_id AS "reflectionId",b.batch_index AS "batchIndex",b.status,b.input,b.output,b.failure_reason AS "failureReason",b.started_at AS "startedAt",b.completed_at AS "completedAt",b.updated_at AS "updatedAt" FROM reflection_memory_batches b JOIN reflection_runs r ON r.id=b.reflection_id WHERE r.agent_id=$1 ORDER BY b.updated_at DESC,b.id LIMIT 200`, [agentId]),
      this.query<QueryResultRow>(`SELECT t.reflection_id AS "reflectionId",t.target,t.batch_index AS "batchIndex",t.anchor_memory_id AS "anchorMemoryId",t.execution_index AS "executionIndex",t.tool_call_id AS "toolCallId",t.tool,t.input,t.result,t.error,t.started_at AS "startedAt",t.finished_at AS "finishedAt" FROM reflection_tool_executions t JOIN reflection_runs r ON r.id=t.reflection_id WHERE r.agent_id=$1 ORDER BY t.created_at DESC,t.id DESC LIMIT 500`, [agentId]),
      this.query<QueryResultRow>(`SELECT x.id,x.reflection_id AS "reflectionId",x.target,x.batch_index AS "batchIndex",x.anchor_memory_id AS "anchorMemoryId",x.resolver_version AS "resolverVersion",x.query_summary AS "querySummary",x.candidate_count AS "candidateCount",x.selected_event_ids AS "selectedEventIds",x.rejected,x.score,x.temporal_decision AS "temporalDecision",x.outcome,x.created_at AS "createdAt" FROM reflection_resolutions x JOIN reflection_runs r ON r.id=x.reflection_id WHERE r.agent_id=$1 ORDER BY x.created_at DESC,x.id DESC LIMIT 200`, [agentId]),
      this.query<QueryResultRow>(`SELECT ca.concern_id AS "concernId",ca.kind,ca.source_concern_id AS "sourceConcernId",ca.reason,ca.event_id AS "eventId",ca.run_id AS "runId",ca.reflection_id AS "reflectionId",ca.evidence_memory_ids AS "evidenceMemoryIds",ca.occurred_at AS "occurredAt",
        c.description,c.status,source_concern.description AS "sourceConcernDescription",
        CASE WHEN source_event.kind='internal' THEN source_event.observation#>>'{content,targetKind}' ELSE source_event.kind END AS "eventKind",
        source_event.observation->>'summary' AS "eventSummary"
        FROM concern_activities ca JOIN concerns c ON c.id=ca.concern_id
        LEFT JOIN concerns source_concern ON source_concern.id=ca.source_concern_id
        LEFT JOIN events source_event ON source_event.id=ca.event_id AND source_event.agent_id=c.agent_id
        WHERE c.agent_id=$1 ORDER BY ca.occurred_at DESC,ca.id DESC LIMIT 100`, [agentId]),
      this.query<QueryResultRow>(`SELECT b.id,b.status,b.impact_reason AS "impactReason",b.failure_reason AS "failureReason",b.next_due_at AS "nextDueAt",b.claimed_at AS "claimedAt",b.consumed_at AS "consumedAt",b.created_at AS "createdAt",b.updated_at AS "updatedAt",c.description AS "focusConcern",COUNT(m.memory_id)::integer AS "memoryCount" FROM concern_reevaluation_batches b LEFT JOIN concerns c ON c.id=b.focus_concern_id LEFT JOIN concern_reevaluation_batch_memories m ON m.batch_id=b.id WHERE b.agent_id=$1 GROUP BY b.id,c.description ORDER BY b.updated_at DESC,b.id DESC LIMIT 100`, [agentId]),
      this.query<QueryResultRow>(`SELECT c.id,c.goal,c.status,c.started_event_id AS "startedEventId",c.last_event_id AS "lastEventId",c.ended_reason AS "endedReason",c.completed_at AS "completedAt",c.created_at AS "createdAt",c.updated_at AS "updatedAt",COUNT(cm.external_message_id)::integer AS "messageCount" FROM conversations c LEFT JOIN conversation_messages cm ON cm.conversation_id=c.id AND cm.agent_id=c.agent_id WHERE c.agent_id=$1 GROUP BY c.id ORDER BY c.updated_at DESC,c.id DESC LIMIT 100`, [agentId]),
      this.query<QueryResultRow>(`SELECT /* lifecycle activity totals */ COUNT(*) FILTER (WHERE ca.kind='created')::integer AS created,COUNT(*) FILTER (WHERE ca.kind='derived')::integer AS derived,COUNT(*) FILTER (WHERE ca.kind='focused')::integer AS focused,COUNT(*) FILTER (WHERE ca.kind='progressed')::integer AS progressed,COUNT(*) FILTER (WHERE ca.kind='reviewed')::integer AS reviewed FROM concern_activities ca JOIN concerns c ON c.id=ca.concern_id WHERE c.agent_id=$1`, [agentId]),
      this.query<QueryResultRow>(`SELECT /* dormant active Concerns */ c.id,c.description,c.why_it_matters AS "whyItMatters",c.created_at AS "createdAt",MAX(ca.occurred_at) FILTER (WHERE ca.kind IN ('focused','progressed','reviewed')) AS "lastMeaningfulAt",MAX(ca.occurred_at) AS "lastActivityAt" FROM concerns c LEFT JOIN concern_activities ca ON ca.concern_id=c.id WHERE c.agent_id=$1 AND c.deleted_at IS NULL AND c.status='active' GROUP BY c.id ORDER BY "lastMeaningfulAt" NULLS FIRST,c.created_at,c.id LIMIT 50`, [agentId]),
      this.query<QueryResultRow>(`SELECT /* embedding-neighbor Concern candidates */ a.id AS "leftConcernId",a.description AS "leftDescription",b.id AS "rightConcernId",b.description AS "rightDescription",1-(a.embedding <=> b.embedding) AS similarity FROM concerns a JOIN concerns b ON b.agent_id=a.agent_id AND b.id>a.id WHERE a.agent_id=$1 AND a.deleted_at IS NULL AND b.deleted_at IS NULL AND a.status='active' AND b.status='active' AND a.embedding IS NOT NULL AND b.embedding IS NOT NULL ORDER BY a.embedding <=> b.embedding,a.id,b.id LIMIT 20`, [agentId])
    ]);
    const reflectionAttempts = rawReflectionAttempts.map((attempt) => ({ ...attempt, toolExecutions: reflectionToolExecutions.filter((execution) => execution.reflectionId === attempt.reflectionId && execution.target === attempt.target) }));
    const reflectionMemoryBatches = rawReflectionMemoryBatches.map((batch) => ({ ...batch, toolExecutions: reflectionToolExecutions.filter((execution) => execution.reflectionId === batch.reflectionId && execution.target === "memory" && execution.batchIndex === batch.batchIndex) }));
    const lifecycle = concernLifecycleHealth(currentConcerns.map((concern) => ({ id: String(concern.id), status: typeof concern.status === "string" ? concern.status : "unknown", description: String(concern.description) })), []);
    return { agent, state: { ...(states[0] ?? {}), concerns: currentConcerns }, scheduledTasks, schedules, reflections, reflectionAttempts, reflectionMemoryBatches, reflectionResolutions, concernActivities, concernReevaluationBatches, conversations, concernLifecycle: { current: lifecycle.current, activities: lifecycleTotals[0] ?? {}, dormant: dormantConcerns, similar: similarConcerns } };
  }

  async listRuns(agentId: string, limit = 30): Promise<readonly RunListItem[]> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    return this.query<RunListItem & QueryResultRow>(`SELECT r.id,r.event_id AS "eventId",e.kind AS "eventKind",
      CASE WHEN e.kind='internal' THEN e.observation#>>'{content,targetKind}' ELSE NULL END AS "internalKind",e.observation AS "eventSummary",
      r.started_at AS "startedAt",r.finished_at AS "finishedAt",r.failure_reason AS "failureReason",r.result
      FROM agent_runs r JOIN events e ON e.id=r.event_id WHERE r.agent_id=$1 ORDER BY r.started_at DESC,r.id LIMIT $2`, [agentId, bounded]);
  }

  async listEvents(agentId: string, limit = 50): Promise<readonly EventListItem[]> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    return this.query<EventListItem & QueryResultRow>(`SELECT e.id,e.agent_id AS "agentId",e.kind,
      CASE WHEN e.kind='internal' THEN e.observation#>>'{content,targetKind}' ELSE NULL END AS "internalKind",
      e.observation,e.source,e.causation_id AS "causationId",e.correlation_id AS "correlationId",CASE WHEN g.decision='ignore' THEN 'ignored' ELSE e.status END AS status,e.occurred_at AS "occurredAt",
      r.id AS "runId",r.started_at AS "startedAt",r.finished_at AS "finishedAt",r.failure_reason AS "failureReason",r.result,
      CASE WHEN g.event_id IS NULL THEN NULL ELSE jsonb_build_object('decision',g.decision,'reason',g.reason,'conversationGoal',g.conversation_goal,'input',g.input,'modelCalls',g.model_calls,'retrievalCount',g.retrieval_count,'failureReason',g.failure_reason,'createdAt',g.created_at) END AS "observationGate"
      FROM events e LEFT JOIN LATERAL (
        SELECT id,started_at,finished_at,failure_reason,result FROM agent_runs
        WHERE event_id=e.id AND agent_id=e.agent_id ORDER BY started_at DESC,id DESC LIMIT 1
      ) r ON true LEFT JOIN observation_gate_decisions g ON g.event_id=e.id
      WHERE e.agent_id=$1 AND e.kind<>'tool-result' ORDER BY e.occurred_at DESC,e.id DESC LIMIT $2`, [agentId, bounded]);
  }

  async getEventTrace(agentId: string, eventId: string): Promise<EventTrace | undefined> {
    const events = await this.query<QueryResultRow>(`SELECT id,agent_id AS "agentId",kind,observation,source,causation_id AS "causationId",correlation_id AS "correlationId",status,occurred_at AS "occurredAt",created_at AS "createdAt"
      FROM events WHERE agent_id=$1 AND id=$2`, [agentId, eventId]);
    const event = events[0];
    if (event === undefined) return undefined;
    const runs = await this.query<QueryResultRow>(`SELECT id,agent_id AS "agentId",event_id AS "eventId",input_state_version AS "inputStateVersion",input_snapshot AS "inputSnapshot",result,failure_reason AS "failureReason",started_at AS "startedAt",finished_at AS "finishedAt"
      FROM agent_runs WHERE agent_id=$1 AND event_id=$2 ORDER BY started_at DESC,id DESC LIMIT 1`, [agentId, eventId]);
    const run = runs[0]; const runId = typeof run?.id === "string" ? run.id : undefined;
    const [stateChanges, toolExecutions, memoryMutations, predictions, predictionEvaluations, g3Tasks, experienceIntegrations, scheduledTasks, outbox, derivedEvents, concernActivities, gates] = await Promise.all([
      runId === undefined ? Promise.resolve([]) : this.query<QueryResultRow>(`SELECT id,target,operation,before,after,reason,evidence_ids AS "evidenceIds",created_at AS "createdAt" FROM state_changes WHERE run_id=$1 ORDER BY created_at,id`, [runId]),
      runId === undefined ? Promise.resolve([]) : this.query<QueryResultRow>(`SELECT id,tool_call_id AS "toolCallId",tool,input,result,error,error IS NULL AS ok,started_at AS "startedAt",finished_at AS "finishedAt" FROM tool_executions WHERE run_id=$1 ORDER BY started_at,id`, [runId]),
      this.query<QueryResultRow>(`SELECT id,memory_id AS "memoryId",operation,candidate_memory_id AS "candidateMemoryId",intent_index AS "intentIndex",intent,created_at AS "createdAt" FROM memory_mutations WHERE agent_id=$1 AND source_event_id=$2 ORDER BY created_at,id`, [agentId, eventId]),
      this.query<QueryResultRow>(`SELECT p.id,p.source_run_id AS "sourceRunId",p.output,p.created_at AS "createdAt" FROM prediction_records p LEFT JOIN agent_runs r ON r.id=p.source_run_id LEFT JOIN events e ON e.id=r.event_id WHERE COALESCE(e.agent_id,p.agent_id)=$1 AND COALESCE(e.id,p.source_event_id)=$2 ORDER BY p.created_at,p.id`, [agentId, eventId]),
      this.query<QueryResultRow>(`SELECT pe.id,pe.prediction_id AS "predictionId",pe."group" AS "group",pe.candidate_index AS "candidateIndex",pe.match,pe.surprise,pe.difference,pe.interpretation,pe.uncertainty,pe.attribution,pe.observed,pe.error_direction AS "errorDirection",pe.effect,pe.effect_evidence AS "effectEvidence",pe.created_at AS "createdAt"
        FROM prediction_evaluations pe JOIN prediction_records pr ON pr.id=pe.prediction_id LEFT JOIN agent_runs r ON r.id=pr.source_run_id LEFT JOIN events e ON e.id=r.event_id
        WHERE COALESCE(e.agent_id,pr.agent_id,pe.agent_id)=$1 AND COALESCE(e.id,pr.source_event_id)=$2 ORDER BY pe.created_at,pe.id`, [agentId, eventId]),
      this.query<QueryResultRow>(`SELECT id,source_prediction_id AS "sourcePredictionId",status,input,output,failure_reason AS "failureReason",created_at AS "createdAt",completed_at AS "completedAt" FROM g3_tasks WHERE agent_id=$1 AND source_event_id=$2 ORDER BY created_at,id`, [agentId, eventId]),
      this.query<QueryResultRow>(`SELECT i.id,i.status,i.output,i.applied,i.failure_reason AS "failureReason",i.created_at AS "createdAt",i.completed_at AS "completedAt" FROM experience_integrations i JOIN agent_runs r ON r.id=i.source_run_id WHERE r.agent_id=$1 AND r.event_id=$2 ORDER BY i.created_at,i.id`, [agentId, eventId]),
      runId === undefined ? Promise.resolve([]) : this.query<QueryResultRow>(`SELECT id,execute_at AS "executeAt",instruction,reason,destination,status,attempt,execution_event_id AS "executionEventId",failure_reason AS "failureReason",updated_at AS "updatedAt" FROM scheduled_tasks WHERE agent_id=$1 AND source_run_id=$2 ORDER BY execute_at,id`, [agentId, runId]),
      runId === undefined ? Promise.resolve([]) : this.query<QueryResultRow>(`SELECT id,status,attempt,available_at AS "availableAt",sent_at AS "sentAt",envelope FROM outbox_messages WHERE agent_id=$1 AND envelope#>>'{payload,action,id}'=$2 ORDER BY created_at,id`, [agentId, runId]),
      this.query<QueryResultRow>(`SELECT e.id,e.kind,e.status,e.source,e.observation,e.causation_id AS "causationId",e.correlation_id AS "correlationId",e.occurred_at AS "occurredAt",r.id AS "runId",r.failure_reason AS "failureReason"
        FROM events e LEFT JOIN LATERAL (SELECT id,failure_reason FROM agent_runs WHERE event_id=e.id AND agent_id=e.agent_id ORDER BY started_at DESC,id DESC LIMIT 1) r ON true
        WHERE e.agent_id=$1 AND e.kind<>'tool-result' AND (e.causation_id=$2 OR ($3::text IS NOT NULL AND e.causation_id=$3)) ORDER BY e.occurred_at,e.id`, [agentId, eventId, runId ?? null]),
      this.query<QueryResultRow>(`SELECT ca.concern_id AS "concernId",ca.kind,ca.source_concern_id AS "sourceConcernId",ca.reason,ca.event_id AS "eventId",ca.run_id AS "runId",ca.reflection_id AS "reflectionId",ca.evidence_memory_ids AS "evidenceMemoryIds",ca.occurred_at AS "occurredAt",
        c.description,c.status,source_concern.description AS "sourceConcernDescription",
        CASE WHEN source_event.kind='internal' THEN source_event.observation#>>'{content,targetKind}' ELSE source_event.kind END AS "eventKind",
        source_event.observation->>'summary' AS "eventSummary"
        FROM concern_activities ca JOIN concerns c ON c.id=ca.concern_id
        LEFT JOIN concerns source_concern ON source_concern.id=ca.source_concern_id
        LEFT JOIN events source_event ON source_event.id=ca.event_id AND source_event.agent_id=c.agent_id
        WHERE c.agent_id=$1 AND (ca.event_id=$2 OR ($3::text IS NOT NULL AND ca.run_id=$3)) ORDER BY ca.occurred_at,ca.id`, [agentId, eventId, runId ?? null]),
      this.query<QueryResultRow>(`SELECT decision,reason,conversation_goal AS "conversationGoal",input,model_calls AS "modelCalls",retrieval_count AS "retrievalCount",failure_reason AS "failureReason",created_at AS "createdAt" FROM observation_gate_decisions WHERE event_id=$1`, [eventId])
    ]);
    const observationGate = gates[0] as Record<string, unknown> | undefined;
    return { event: observationGate === undefined ? event : { ...event, observationGate }, run, stateChanges, toolExecutions, memoryMutations, predictions, predictionEvaluations, g3Tasks, experienceIntegrations, scheduledTasks, outbox, derivedEvents, concernActivities, observationGate };
  }

  async getRun(agentId: string, runId: string): Promise<RunDetail | undefined> {
    const runs = await this.query<QueryResultRow>(`SELECT r.id,r.agent_id AS "agentId",r.event_id AS "eventId",r.input_state_version AS "inputStateVersion",r.input_snapshot AS "inputSnapshot",
      r.result,r.failure_reason AS "failureReason",r.started_at AS "startedAt",r.finished_at AS "finishedAt",
      e.kind AS "eventKind",e.observation,e.source,e.correlation_id AS "correlationId",e.causation_id AS "causationId",e.status AS "eventStatus",e.occurred_at AS "occurredAt"
      FROM agent_runs r JOIN events e ON e.id=r.event_id WHERE r.agent_id=$1 AND r.id=$2`, [agentId, runId]);
    const run = runs[0];
    if (run === undefined) return undefined;
    const [stateChanges, toolExecutions, concernActivities] = await Promise.all([
      this.query<QueryResultRow>(`SELECT id,target,operation,before,after,reason,evidence_ids AS "evidenceIds",created_at AS "createdAt" FROM state_changes WHERE run_id=$1 ORDER BY created_at,id`, [runId]),
      this.query<QueryResultRow>(`SELECT id,tool_call_id AS "toolCallId",tool,input,result,error,error IS NULL AS ok,started_at AS "startedAt",finished_at AS "finishedAt" FROM tool_executions WHERE run_id=$1 ORDER BY started_at,id`, [runId]),
      this.query<QueryResultRow>(`SELECT ca.concern_id AS "concernId",ca.kind,ca.source_concern_id AS "sourceConcernId",ca.reason,ca.event_id AS "eventId",ca.run_id AS "runId",ca.reflection_id AS "reflectionId",ca.evidence_memory_ids AS "evidenceMemoryIds",ca.occurred_at AS "occurredAt",
        c.description,c.status,source_concern.description AS "sourceConcernDescription",
        CASE WHEN source_event.kind='internal' THEN source_event.observation#>>'{content,targetKind}' ELSE source_event.kind END AS "eventKind",
        source_event.observation->>'summary' AS "eventSummary"
        FROM concern_activities ca JOIN concerns c ON c.id=ca.concern_id
        LEFT JOIN concerns source_concern ON source_concern.id=ca.source_concern_id
        LEFT JOIN events source_event ON source_event.id=ca.event_id AND source_event.agent_id=c.agent_id
        WHERE c.agent_id=$1 AND ca.run_id=$2 ORDER BY ca.occurred_at,ca.id`, [agentId, runId])
    ]);
    return { run, stateChanges, toolExecutions, concernActivities };
  }

  async listMemories(agentId: string, limit = 50): Promise<readonly Record<string, unknown>[]> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    return this.query<QueryResultRow>(`SELECT id,kind,content,importance,retrieval_priority AS "retrievalPriority",embedding_status AS "embeddingStatus",
      embedding_error AS "embeddingError",source_agent_id AS "sourceAgentId",evidence_event_ids AS "evidenceEventIds",occurred_at AS "occurredAt",created_at AS "createdAt"
      FROM memories WHERE agent_id=$1 ORDER BY occurred_at DESC,id LIMIT $2`, [agentId, bounded]);
  }

  async listPredictions(agentId: string, limit = 50): Promise<readonly Record<string, unknown>[]> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    return this.query<QueryResultRow>(`SELECT p.id,COALESCE(e.id,p.source_event_id) AS "sourceEventId",p.source_run_id AS "sourceRunId",p.output,p.created_at AS "createdAt" FROM prediction_records p LEFT JOIN agent_runs r ON r.id=p.source_run_id LEFT JOIN events e ON e.id=r.event_id WHERE COALESCE(e.agent_id,p.agent_id)=$1 ORDER BY p.created_at DESC,p.id LIMIT $2`, [agentId, bounded]);
  }

  async listMemoryUpdates(agentId: string, limit = 50): Promise<readonly Record<string, unknown>[]> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    return this.query<QueryResultRow>(`SELECT id,memory_id AS "memoryId",operation,candidate_memory_id AS "candidateMemoryId",candidate_memory_ids AS "candidateMemoryIds",source_event_id AS "sourceEventId",source_run_id AS "sourceRunId",source_kind AS "sourceKind",source_id AS "sourceId",intent_index AS "intentIndex",attempt,source_agent_id AS "sourceAgentId",intent,before,after,reason,evidence_event_ids AS "evidenceEventIds",evidence_memory_ids AS "evidenceMemoryIds",status,failure_reason AS "failureReason",idempotency_key AS "idempotencyKey",applied_at AS "appliedAt",created_at AS "createdAt" FROM memory_mutations WHERE agent_id=$1 ORDER BY created_at DESC,id LIMIT $2`, [agentId, bounded]);
  }

  /** Operations whose source Event is not present in the Event ledger. */
  async listTraceGaps(agentId: string, limit = 50): Promise<readonly Record<string, unknown>[]> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    return this.query<QueryResultRow>(`SELECT m.id,m.operation,m.memory_id AS "memoryId",m.source_event_id AS "sourceEventId",m.intent_index AS "intentIndex",m.intent,m.created_at AS "createdAt"
      FROM memory_mutations m LEFT JOIN events e ON e.id=m.source_event_id AND e.agent_id=m.agent_id
      WHERE m.agent_id=$1 AND m.source_event_id IS NOT NULL AND e.id IS NULL
      ORDER BY m.created_at DESC,m.id LIMIT $2`, [agentId, bounded]);
  }

  async listBackgroundExperiences(agentId: string, limit = 50): Promise<readonly Record<string, unknown>[]> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    return this.query<QueryResultRow>(`SELECT id,phase,place,participants,relationship,action,feeling,outcome,lesson,importance,tags,embedding_status AS "embeddingStatus",occurred_at AS "occurredAt" FROM background_experiences WHERE agent_id=$1 ORDER BY occurred_at DESC,id LIMIT $2`, [agentId, bounded]);
  }

  async listG3Tasks(agentId: string, limit = 50): Promise<readonly Record<string, unknown>[]> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    return this.query<QueryResultRow>(`SELECT id,source_prediction_id AS "sourcePredictionId",source_event_id AS "sourceEventId",source_run_id AS "sourceRunId",status,attempt,deadline_at AS "deadlineAt",lease_until AS "leaseUntil",input,output,failure_reason AS "failureReason",created_at AS "createdAt",completed_at AS "completedAt" FROM g3_tasks WHERE agent_id=$1 ORDER BY created_at DESC,id LIMIT $2`, [agentId, bounded]);
  }
}
