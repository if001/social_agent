import { eq } from "drizzle-orm";

import type { ObservationGateContextLoader, ObservationGateInput } from "../../application/observation-gate.js";
import type { RetrievalService } from "../../application/ports.js";
import { DomainError, type DomainEvent } from "../../domain/contracts.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { agentStates } from "./schema.js";

const bounded = (value: string, limit: number): string => value.length <= limit ? value : `${value.slice(0, limit)}…`;
const strings = (value: unknown, limit: number): readonly string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "").slice(0, limit).map((item) => bounded(item, 240)) : [];

export class PostgresObservationGateContext implements ObservationGateContextLoader {
  constructor(private readonly database: RuntimeDatabase, private readonly retrieval: RetrievalService) {}

  async load(event: DomainEvent, _signal: AbortSignal): Promise<ObservationGateInput> {
    if (event.kind !== "message-received" || event.payload.senderKind !== "peer" || event.payload.addressing !== "observed") throw new DomainError("VALIDATION", "Observation Gate accepts peer/observed only");
    const text = typeof event.payload.text === "string" ? event.payload.text : undefined;
    const peerName = typeof event.payload.peerName === "string" ? event.payload.peerName : undefined;
    if (text === undefined || peerName === undefined) throw new DomainError("VALIDATION", "Observed peer Event requires text and peerName");
    const state = (await this.database.db.select({ concerns: agentStates.concerns, relationships: agentStates.relationships }).from(agentStates).where(eq(agentStates.agentId, event.agentId)).limit(1))[0];
    if (state === undefined) throw new DomainError("NOT_FOUND", `Agent state not found: ${event.agentId}`);
    const subjectId = typeof event.payload.subjectId === "string" ? event.payload.subjectId : undefined;
    const relationship = Array.isArray(state.relationships) && subjectId !== undefined
      ? state.relationships.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null).find((item) => item.subjectId === subjectId && typeof item.description === "string")?.description as string | undefined
      : undefined;
    const concerns = Array.isArray(state.concerns) ? state.concerns.filter((item): item is Record<string, unknown> => typeof item === "object" && item !== null && item.status === "active" && typeof item.description === "string").slice(0, 3).map((item) => bounded(item.description as string, 240)) : [];
    const memories = (await this.retrieval.retrieve({ agentId: event.agentId, query: text, scope: "conversation", ...(subjectId === undefined ? {} : { subjectIds: [subjectId], subjectFilter: true }), limit: 3 })).map((item) => bounded(item.content, 320));
    return { text: bounded(text, 1_200), peerName: bounded(peerName, 120), ...(relationship === undefined ? {} : { relationship: bounded(relationship, 400) }), concerns: strings(concerns, 3), memories };
  }
}
