import { and, desc, eq, isNotNull, sql } from "drizzle-orm";

import type { ObservationGateContextLoader, ObservationGateInput } from "../../application/observation-gate.js";
import type { RetrievalService } from "../../application/ports.js";
import { DomainError, type DomainEvent } from "../../domain/contracts.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { agentRuns, agentStates, events, eventSubjects } from "./schema.js";

const bounded = (value: string, limit: number): string => value.length <= limit ? value : `${value.slice(0, limit)}…`;
const strings = (value: unknown, limit: number): readonly string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").slice(0, limit).map((item) => bounded(item, 240)) : [];
const responseText = (value: unknown): string | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const output = (value as Record<string, unknown>).output;
  if (typeof output !== "object" || output === null) return undefined;
  const action = (output as Record<string, unknown>).action;
  if (typeof action !== "object" || action === null || (action as Record<string, unknown>).type !== "respond") return undefined;
  const record = action as Record<string, unknown>;
  if (typeof record.content === "string") return record.content;
  for (const route of [record.observedReply, record.peer]) {
    if (typeof route === "object" && route !== null && typeof (route as Record<string, unknown>).content === "string") return (route as Record<string, unknown>).content as string;
  }
  return undefined;
};

export class PostgresObservationGateContext implements ObservationGateContextLoader {
  constructor(private readonly database: RuntimeDatabase, private readonly retrieval: RetrievalService) {}

  async load(event: DomainEvent, signal: AbortSignal): Promise<ObservationGateInput> {
    signal.throwIfAborted();
    if (event.kind !== "message-received" || event.payload.senderKind !== "peer" || event.payload.addressing !== "observed") throw new DomainError("VALIDATION", "Observation Gate accepts peer/observed only");
    const text = typeof event.payload.text === "string" ? event.payload.text : undefined;
    const peerName = typeof event.payload.peerName === "string" ? event.payload.peerName : undefined;
    if (text === undefined || peerName === undefined) throw new DomainError("VALIDATION", "Observed peer Event requires text and peerName");
    const [state, retrievedMemories, priorRuns] = await Promise.all([
      this.database.db.select({ disposition: agentStates.disposition, selfStory: agentStates.selfStory, mood: agentStates.mood, concerns: agentStates.concerns, relationships: agentStates.relationships }).from(agentStates).where(eq(agentStates.agentId, event.agentId)).limit(1),
      this.retrieval.retrieve({ agentId: event.agentId, query: text, scope: "conversation", ...(typeof event.payload.subjectId === "string" ? { subjectIds: [event.payload.subjectId], subjectFilter: true } : {}), limit: 3 }),
      typeof event.payload.subjectId !== "string" ? Promise.resolve([]) : this.database.db.select({ result: agentRuns.result }).from(agentRuns)
        .innerJoin(events, and(eq(events.id, agentRuns.eventId), eq(events.agentId, agentRuns.agentId)))
        .innerJoin(eventSubjects, eq(eventSubjects.eventId, events.id))
        .where(and(
          eq(events.agentId, event.agentId),
          eq(events.kind, "message-received"),
          eq(events.status, "completed"),
          eq(eventSubjects.subjectId, event.payload.subjectId),
          isNotNull(agentRuns.finishedAt),
          sql`${agentRuns.result}->'output'->'action'->>'type' = 'respond'`
        ))
        .orderBy(desc(events.occurredAt), desc(agentRuns.startedAt)).limit(1)
    ]);
    const currentState = state[0];
    if (currentState === undefined) throw new DomainError("NOT_FOUND", `Agent state not found: ${event.agentId}`);
    const subjectId = typeof event.payload.subjectId === "string" ? event.payload.subjectId : undefined;
    const relationship = Array.isArray(currentState.relationships) && subjectId !== undefined
      ? currentState.relationships.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null).find((item) => item.subjectId === subjectId && typeof item.description === "string")?.description as string | undefined
      : undefined;
    const rawConcerns: unknown = currentState.concerns;
    const concerns = Array.isArray(rawConcerns) ? rawConcerns.filter((item: unknown): item is { status: "active"; description: string } => typeof item === "object" && item !== null && "status" in item && item.status === "active" && "description" in item && typeof item.description === "string").slice(0, 3).map((item) => bounded(item.description, 240)) : [];
    const memories = retrievedMemories.map((item) => bounded(item.content, 320));
    const recentSelfSpeech = priorRuns.map(({ result }) => responseText(result)).find((value): value is string => value !== undefined && value.trim() !== "");
    return { text: bounded(text, 1_200), peerName: bounded(peerName, 120), self: { disposition: bounded(currentState.disposition, 240), story: bounded(currentState.selfStory, 320) }, mood: bounded(currentState.mood, 120), ...(relationship === undefined ? {} : { relationship: bounded(relationship, 400) }), concerns: strings(concerns, 3), memories, ...(recentSelfSpeech === undefined ? {} : { recentSelfSpeech: bounded(recentSelfSpeech, 320) }) };
  }
}
