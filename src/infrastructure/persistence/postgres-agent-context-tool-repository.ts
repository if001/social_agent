import { and, asc, desc, eq, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";

import type { EventRetrievalInput, RetrievedEvent, RetrievalInput, RetrievalService } from "../../application/ports.js";
import type { Observation, RetrievedItem } from "../../domain/contracts.js";
import type { AgentContextState, AgentContextToolRepository, AgentSelfState, ConcernActivity, ConcernDueFocus, EvidenceMemory, ToolExecutionObservation } from "../tools/agent-context-tools.js";
import { PostgresRetrievalService } from "./postgres-retrieval-service.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { agents, agentRuns, agentStates, concernActivities, concerns, events, memories, toolExecutions } from "./schema.js";
import { ConcernRepository } from "./concern-repository.js";

function actor(observation: unknown): Observation["actor"] | undefined {
  if (typeof observation !== "object" || observation === null) return undefined;
  const actor = "actor" in observation ? observation.actor : undefined;
  if (typeof actor !== "object" || actor === null) return undefined;
  const id = "id" in actor ? actor.id : undefined;
  const type = "type" in actor ? actor.type : undefined;
  return typeof id === "string" && (type === "human" || type === "unknown" || type === "agent") ? { id, type } : undefined;
}

export class PostgresAgentContextToolRepository implements AgentContextToolRepository {
  private readonly eventRetrieval: PostgresRetrievalService;

  constructor(private readonly database: RuntimeDatabase, private readonly retrieval: RetrievalService = new PostgresRetrievalService(database.native)) {
    this.eventRetrieval = retrieval instanceof PostgresRetrievalService ? retrieval : new PostgresRetrievalService(database.native);
  }

  retrieve(input: RetrievalInput): Promise<readonly RetrievedItem[]> { return this.retrieval.retrieve(input); }
  retrieveEvents(input: EventRetrievalInput): Promise<readonly RetrievedEvent[]> { return this.eventRetrieval.retrieveEvents(input); }

  async loadState(agentId: string): Promise<AgentContextState | undefined> {
    const state = (await this.database.db.select({
      relationships: agentStates.relationships,
      mood: agentStates.mood
    }).from(agentStates).where(eq(agentStates.agentId, agentId)).limit(1))[0];
    return state === undefined ? undefined : { ...state, concerns: await new ConcernRepository(this.database.db).list(agentId) };
  }

  async listConcernActivityTimes(agentId: string, concernIds: readonly string[]): Promise<ReadonlyMap<string, Date>> {
    if (concernIds.length === 0) return new Map();
    const meaningfulKinds = ["created", "derived", "reviewed", "focused", "progressed", "status-changed", "baseline"];
    const rows = await this.database.db.select({
      concernId: concernActivities.concernId,
      lastMeaningfulAt: sql<Date | null>`max(${concernActivities.occurredAt}) filter (where ${inArray(concernActivities.kind, meaningfulKinds)})`
    }).from(concernActivities).innerJoin(concerns, eq(concerns.id, concernActivities.concernId)).where(and(
      eq(concerns.agentId, agentId),
      inArray(concernActivities.concernId, [...concernIds])
    )).groupBy(concernActivities.concernId);
    return new Map(rows.flatMap((row) => row.lastMeaningfulAt === null ? [] : [[row.concernId, new Date(row.lastMeaningfulAt)] as const]));
  }

  async listConcernActivities(agentId: string, concernId: string, cursor: { readonly occurredAt: string; readonly id: string } | undefined, limit: number): Promise<readonly ConcernActivity[]> {
    const cursorCondition = cursor === undefined ? undefined : or(
      lt(concernActivities.occurredAt, new Date(cursor.occurredAt)),
      and(eq(concernActivities.occurredAt, new Date(cursor.occurredAt)), lt(concernActivities.id, cursor.id))
    );
    return (await this.database.db.select({ activity: concernActivities }).from(concernActivities).innerJoin(concerns, eq(concerns.id, concernActivities.concernId)).where(and(
      eq(concerns.agentId, agentId),
      eq(concernActivities.concernId, concernId),
      cursorCondition
    )).orderBy(desc(concernActivities.occurredAt), desc(concernActivities.id)).limit(limit)).map(({ activity: row }) => ({
      id: row.id, kind: row.kind, occurredAt: row.occurredAt,
      eventId: row.eventId, runId: row.runId, reflectionId: row.reflectionId,
      sourceConcernId: row.sourceConcernId, reason: row.reason,
      evidenceMemoryIds: row.evidenceMemoryIds
    }));
  }

  async listEvidenceMemories(agentId: string, ids: readonly string[], limit: number): Promise<readonly EvidenceMemory[]> {
    if (ids.length === 0) return [];
    return this.database.db.select({
      id: memories.id, content: memories.content,
      importance: memories.importance, occurredAt: memories.occurredAt
    }).from(memories).where(and(
      eq(memories.agentId, agentId), inArray(memories.id, [...ids])
    )).orderBy(desc(memories.occurredAt), asc(memories.id)).limit(limit);
  }

  async findEventActor(agentId: string, eventId: string): Promise<Observation["actor"] | undefined> {
    const row = (await this.database.db.select({ observation: events.observation }).from(events).where(and(
      eq(events.id, eventId), eq(events.agentId, agentId)
    )).limit(1))[0];
    return actor(row?.observation);
  }

  async findRecentHumanActor(agentId: string, limit: number): Promise<Observation["actor"] | undefined> {
    const rows = await this.database.db.select({ observation: events.observation }).from(events)
      .where(eq(events.agentId, agentId))
      .orderBy(desc(events.occurredAt), desc(events.id)).limit(limit);
    return rows.map((row) => actor(row.observation)).find((value) => value?.type === "human");
  }

  async listRecentActionResults(agentId: string, actorIds: readonly string[], limit: number): Promise<readonly unknown[]> {
    if (actorIds.length === 0) return [];
    const rows = await this.database.db.select({ result: agentRuns.result }).from(agentRuns)
      .innerJoin(events, and(eq(events.id, agentRuns.eventId), eq(events.agentId, agentRuns.agentId)))
      .where(and(
        eq(agentRuns.agentId, agentId),
        sql`${events.observation} #>> '{actor,id}' IN (${sql.join(actorIds.map((actorId) => sql`${actorId}`), sql`, `)})`,
        isNotNull(agentRuns.finishedAt),
        isNull(agentRuns.failureReason)
      )).orderBy(desc(events.occurredAt), desc(events.id), desc(agentRuns.startedAt)).limit(limit);
    return rows.map((row) => row.result);
  }

  async listToolExecutions(agentId: string, eventId: string, limit: number): Promise<readonly ToolExecutionObservation[]> {
    return this.database.db.select({
      tool: toolExecutions.tool, result: toolExecutions.result,
      error: toolExecutions.error, finishedAt: toolExecutions.finishedAt
    }).from(toolExecutions).innerJoin(agentRuns, eq(agentRuns.id, toolExecutions.runId))
      .where(and(eq(agentRuns.eventId, eventId), eq(agentRuns.agentId, agentId)))
      .orderBy(asc(toolExecutions.finishedAt), asc(toolExecutions.id)).limit(limit);
  }

  async loadSelf(agentId: string): Promise<AgentSelfState | undefined> {
    const row = (await this.database.db.select({
      identity: agents.identity, disposition: agentStates.disposition,
      selfStory: agentStates.selfStory, commitments: agentStates.commitments,
      mood: agentStates.mood
    }).from(agents).innerJoin(agentStates, eq(agentStates.agentId, agents.id))
      .where(eq(agents.id, agentId)).limit(1))[0];
    return row;
  }

  async loadConcernDueFocus(agentId: string, concernId: string, evidenceMemoryIds: readonly string[]): Promise<ConcernDueFocus | undefined> {
    const concern = (await this.database.db.select({ description: concerns.description, whyItMatters: concerns.whyItMatters }).from(concerns).where(and(
      eq(concerns.agentId, agentId), eq(concerns.id, concernId), eq(concerns.status, "active"), isNull(concerns.deletedAt)
    )).limit(1))[0];
    if (concern === undefined) return undefined;
    const sourceMemories = evidenceMemoryIds.length === 0 ? [] : await this.database.db.select({ content: memories.content, importance: memories.importance, occurredAt: memories.occurredAt })
      .from(memories).where(and(eq(memories.agentId, agentId), inArray(memories.id, [...evidenceMemoryIds]))).orderBy(desc(memories.occurredAt)).limit(8);
    return { ...concern, sourceMemories };
  }
}
