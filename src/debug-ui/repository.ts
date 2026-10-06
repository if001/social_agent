import type { QueryResultRow } from "pg";

export type SqlQuery = <T extends QueryResultRow>(sql: string, values?: readonly unknown[]) => Promise<readonly T[]>;

export type AgentListItem = { readonly id: string; readonly identity: string; readonly familyId: string; readonly active: boolean; readonly stateUpdatedAt: Date | null };

export type AgentOverview = {
  readonly agent: Record<string, unknown>;
  readonly state: Record<string, unknown>;
  readonly socialContexts: readonly Record<string, unknown>[];
  readonly intentions: readonly Record<string, unknown>[];
  readonly schedules: readonly Record<string, unknown>[];
  readonly candidates: readonly Record<string, unknown>[];
};

export type RunListItem = {
  readonly id: string;
  readonly eventId: string;
  readonly eventKind: string;
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
  readonly postProcessJobs: readonly Record<string, unknown>[];
};

export class DebugUiRepository {
  constructor(private readonly query: SqlQuery) {}

  async listAgents(): Promise<readonly AgentListItem[]> {
    return this.query<AgentListItem & QueryResultRow>(`SELECT a.id,a.identity,a.family_id AS "familyId",a.active,s.updated_at AS "stateUpdatedAt"
      FROM agents a LEFT JOIN agent_states s ON s.agent_id=a.id ORDER BY a.id`);
  }

  async getOverview(agentId: string): Promise<AgentOverview | undefined> {
    const agents = await this.query<QueryResultRow>(`SELECT a.id,a.identity,a.family_id AS "familyId",a.initial_disposition AS "initialDisposition",a.active,
      f.name AS "familyName",f.shared_disposition AS "sharedDisposition",
      s.acquired_disposition AS "acquiredDisposition",s.values,s.interests,s.preferences,s.roles,s.raison_detre AS "raisonDetre",
      s.self_narrative AS "selfNarrative",s.self_continuity AS "selfContinuity"
      FROM agents a JOIN agent_families f ON f.id=a.family_id LEFT JOIN agent_states s ON s.agent_id=a.id WHERE a.id=$1`, [agentId]);
    const agent = agents[0];
    if (agent === undefined) return undefined;
    const [states, socialContexts, intentions, schedules, candidates] = await Promise.all([
      this.query<QueryResultRow>(`SELECT mood,drives,current_interests AS "currentInterests",version,updated_at AS "updatedAt" FROM agent_states WHERE agent_id=$1`, [agentId]),
      this.query<QueryResultRow>(`SELECT id,subject_id AS "subjectId",subject_type AS "subjectType",description,updated_at AS "updatedAt" FROM social_contexts WHERE agent_id=$1 ORDER BY updated_at DESC,id LIMIT 100`, [agentId]),
      this.query<QueryResultRow>(`SELECT id,description,reason,trigger,status,next_review_at AS "nextReviewAt",updated_at AS "updatedAt" FROM intentions WHERE agent_id=$1 ORDER BY (status='active') DESC,updated_at DESC,id LIMIT 100`, [agentId]),
      this.query<QueryResultRow>(`SELECT id,kind,reason,next_due_at AS "nextDueAt",lease_until AS "leaseUntil",updated_at AS "updatedAt" FROM autonomous_schedules WHERE agent_id=$1 ORDER BY next_due_at,id LIMIT 100`, [agentId]),
      this.query<QueryResultRow>(`SELECT id,target,proposed_value AS "proposedValue",status,reason,evidence_event_ids AS "evidenceEventIds",review_after AS "reviewAfter",updated_at AS "updatedAt" FROM long_term_candidates WHERE agent_id=$1 ORDER BY created_at DESC,id LIMIT 100`, [agentId])
    ]);
    return { agent, state: states[0] ?? {}, socialContexts, intentions, schedules, candidates };
  }

  async listRuns(agentId: string, limit = 30): Promise<readonly RunListItem[]> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    return this.query<RunListItem & QueryResultRow>(`SELECT r.id,r.event_id AS "eventId",e.kind AS "eventKind",e.observation AS "eventSummary",
      r.started_at AS "startedAt",r.finished_at AS "finishedAt",r.failure_reason AS "failureReason",r.result
      FROM agent_runs r JOIN events e ON e.id=r.event_id WHERE r.agent_id=$1 ORDER BY r.started_at DESC,r.id LIMIT $2`, [agentId, bounded]);
  }

  async getRun(agentId: string, runId: string): Promise<RunDetail | undefined> {
    const runs = await this.query<QueryResultRow>(`SELECT r.id,r.agent_id AS "agentId",r.event_id AS "eventId",r.input_state_version AS "inputStateVersion",
      r.result,r.failure_reason AS "failureReason",r.started_at AS "startedAt",r.finished_at AS "finishedAt",
      e.kind AS "eventKind",e.observation,e.source,e.correlation_id AS "correlationId",e.causation_id AS "causationId",e.status AS "eventStatus",e.occurred_at AS "occurredAt"
      FROM agent_runs r JOIN events e ON e.id=r.event_id WHERE r.agent_id=$1 AND r.id=$2`, [agentId, runId]);
    const run = runs[0];
    if (run === undefined) return undefined;
    const [stateChanges, toolExecutions, postProcessJobs] = await Promise.all([
      this.query<QueryResultRow>(`SELECT id,target,operation,before,after,reason,evidence_ids AS "evidenceIds",created_at AS "createdAt" FROM state_changes WHERE run_id=$1 ORDER BY created_at,id`, [runId]),
      this.query<QueryResultRow>(`SELECT id,tool_call_id AS "toolCallId",tool,input,result,error,started_at AS "startedAt",finished_at AS "finishedAt",result_event_id AS "resultEventId" FROM tool_executions WHERE run_id=$1 ORDER BY started_at,id`, [runId]),
      this.query<QueryResultRow>(`SELECT id,job_type AS "jobType",status,attempt,available_at AS "availableAt",lease_until AS "leaseUntil",failure_reason AS "failureReason",completed_at AS "completedAt",updated_at AS "updatedAt" FROM post_process_jobs WHERE interaction_run_id=$1 ORDER BY created_at,id`, [runId])
    ]);
    return { run, stateChanges, toolExecutions, postProcessJobs };
  }

  async listMemories(agentId: string, limit = 50): Promise<readonly Record<string, unknown>[]> {
    const bounded = Math.min(Math.max(limit, 1), 100);
    return this.query<QueryResultRow>(`SELECT id,kind,content,importance,retrieval_priority AS "retrievalPriority",embedding_status AS "embeddingStatus",
      embedding_error AS "embeddingError",source_agent_id AS "sourceAgentId",evidence_event_ids AS "evidenceEventIds",occurred_at AS "occurredAt",created_at AS "createdAt"
      FROM memories WHERE agent_id=$1 ORDER BY occurred_at DESC,id LIMIT $2`, [agentId, bounded]);
  }
}
