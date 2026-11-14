import type { EventRetrievalInput, RetrievedEvent, RetrievalInput, RetrievalService } from "../../application/ports.js";
import type { RetrievedItem } from "../../domain/contracts.js";
import type { AgentContextState, AgentContextToolRepository, AgentSelfState, ConcernActivity, EvidenceMemory, ToolExecutionObservation } from "../tools/agent-context-tools.js";
import { PostgresRetrievalService } from "./postgres-retrieval-service.js";
import type { RuntimeDatabase } from "./runtime-database.js";

type StateRow = { concerns: unknown; relationships: unknown; mood: string };
type ActivityRow = { id: string; kind: string; occurred_at: Date; event_id: string | null; run_id: string | null; reflection_id: string | null; evidence_memory_ids: unknown };

function actorId(observation: unknown): string | undefined {
  if (typeof observation !== "object" || observation === null) return undefined;
  const actor = "actor" in observation ? observation.actor : undefined;
  if (typeof actor !== "object" || actor === null) return undefined;
  const id = "id" in actor ? actor.id : undefined;
  const type = "type" in actor ? actor.type : undefined;
  return typeof id === "string" && (type === "human" || type === "unknown") ? id : undefined;
}

export class PostgresAgentContextToolRepository implements AgentContextToolRepository {
  private readonly eventRetrieval: PostgresRetrievalService;

  constructor(private readonly database: RuntimeDatabase, private readonly retrieval: RetrievalService = new PostgresRetrievalService(database.native)) {
    this.eventRetrieval = retrieval instanceof PostgresRetrievalService ? retrieval : new PostgresRetrievalService(database.native);
  }

  retrieve(input: RetrievalInput): Promise<readonly RetrievedItem[]> { return this.retrieval.retrieve(input); }
  retrieveEvents(input: EventRetrievalInput): Promise<readonly RetrievedEvent[]> { return this.eventRetrieval.retrieveEvents(input); }

  async loadState(agentId: string): Promise<AgentContextState | undefined> {
    return (await this.database.native.query<StateRow>("SELECT concerns,relationships,mood FROM agent_states WHERE agent_id=$1", [agentId])).rows[0];
  }

  async listConcernActivityTimes(agentId: string, concernIds: readonly string[]): Promise<ReadonlyMap<string, Date>> {
    const rows = (await this.database.native.query<{ concern_id: string; last_meaningful_at: Date | null }>("SELECT concern_id,max(occurred_at) FILTER (WHERE kind=ANY($2::text[])) AS last_meaningful_at FROM concern_activities WHERE agent_id=$1 AND concern_id=ANY($3::text[]) GROUP BY concern_id", [agentId, ["created", "derived", "reviewed", "focused", "progressed", "status-changed", "baseline"], concernIds])).rows;
    return new Map(rows.flatMap((row) => row.last_meaningful_at === null ? [] : [[row.concern_id, row.last_meaningful_at] as const]));
  }

  async listConcernActivities(agentId: string, concernId: string, cursor: { readonly occurredAt: string; readonly id: string } | undefined, limit: number): Promise<readonly ConcernActivity[]> {
    const rows = (await this.database.native.query<ActivityRow>(`SELECT id,kind,occurred_at,event_id,run_id,reflection_id,evidence_memory_ids
      FROM concern_activities WHERE agent_id=$1 AND concern_id=$2 AND ($3::timestamptz IS NULL OR occurred_at<$3 OR (occurred_at=$3 AND id<$4))
      ORDER BY occurred_at DESC,id DESC LIMIT $5`, [agentId, concernId, cursor?.occurredAt ?? null, cursor?.id ?? null, limit])).rows;
    return rows.map((row) => ({ id: row.id, kind: row.kind, occurredAt: row.occurred_at, eventId: row.event_id, runId: row.run_id, reflectionId: row.reflection_id, evidenceMemoryIds: row.evidence_memory_ids }));
  }

  async listEvidenceMemories(agentId: string, ids: readonly string[], limit: number): Promise<readonly EvidenceMemory[]> {
    if (ids.length === 0) return [];
    const rows = (await this.database.native.query<{ id: string; content: string; importance: string; occurred_at: Date }>("SELECT id,content,importance,occurred_at FROM memories WHERE agent_id=$1 AND id=ANY($2::text[]) ORDER BY occurred_at DESC,id LIMIT $3", [agentId, ids, limit])).rows;
    return rows.map((row) => ({ id: row.id, content: row.content, importance: row.importance, occurredAt: row.occurred_at }));
  }

  async findEventActor(agentId: string, eventId: string): Promise<string | undefined> {
    const row = (await this.database.native.query<{ observation: unknown }>("SELECT observation FROM events WHERE id=$1 AND agent_id=$2", [eventId, agentId])).rows[0];
    return actorId(row?.observation);
  }

  async findRecentHumanActor(agentId: string, limit: number): Promise<string | undefined> {
    const rows = (await this.database.native.query<{ observation: unknown }>("SELECT observation FROM events WHERE agent_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT $2", [agentId, limit])).rows;
    return rows.map((row) => actorId(row.observation)).find((value) => value !== undefined);
  }

  async listRecentActionResults(agentId: string, subjectId: string, limit: number): Promise<readonly unknown[]> {
    const rows = (await this.database.native.query<{ result: unknown }>(`SELECT r.result FROM agent_runs r JOIN events e ON e.id=r.event_id AND e.agent_id=r.agent_id
      WHERE r.agent_id=$1 AND e.observation #>> '{actor,id}'=$2 AND r.finished_at IS NOT NULL AND r.failure_reason IS NULL
      ORDER BY e.occurred_at DESC,e.id DESC,r.started_at DESC LIMIT $3`, [agentId, subjectId, limit])).rows;
    return rows.map((row) => row.result);
  }

  async listToolExecutions(agentId: string, eventId: string, limit: number): Promise<readonly ToolExecutionObservation[]> {
    const rows = (await this.database.native.query<{ tool: string; result: unknown; error: string | null; finished_at: Date }>("SELECT t.tool,t.result,t.error,t.finished_at FROM tool_executions t JOIN agent_runs r ON r.id=t.run_id WHERE r.event_id=$1 AND r.agent_id=$2 ORDER BY t.finished_at,t.id LIMIT $3", [eventId, agentId, limit])).rows;
    return rows.map((row) => ({ tool: row.tool, result: row.result, error: row.error, finishedAt: row.finished_at }));
  }

  async loadSelf(agentId: string): Promise<AgentSelfState | undefined> {
    const row = (await this.database.native.query<{ identity: string; disposition: string; self_story: string; commitments: unknown; mood: string }>("SELECT a.identity,s.disposition,s.self_story,s.commitments,s.mood FROM agents a JOIN agent_states s ON s.agent_id=a.id WHERE a.id=$1", [agentId])).rows[0];
    return row === undefined ? undefined : { identity: row.identity, disposition: row.disposition, selfStory: row.self_story, commitments: row.commitments, mood: row.mood };
  }
}
