import type { Pool, QueryResultRow } from "pg";

import { ContextBuilder, type ContextBudget } from "../../application/context-builder.js";
import type { EmbeddingProvider, IdGenerator } from "../../application/ports.js";
import { AgentCoreInputSchema, DomainError, ObservationSchema, type AgentCoreInput, type DomainEvent, type Intention, type Memory, type Observation, type RunLimits, type SocialContext } from "../../domain/contracts.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { buildRelevantMemoryQuery } from "../../application/memory-query.js";
import { PostgresMemoryRetriever } from "./postgres-memory-retriever.js";

type AgentRow = QueryResultRow & {
  id: string; family_id: string; identity: string; initial_disposition: string; active: boolean;
  acquired_disposition: string; values: string; interests: unknown; preferences: unknown; roles: unknown; raison_detre: string | null; self_narrative: string; self_continuity: string;
  emotion: string; mood: string; drives: unknown; desires: unknown; current_interests: unknown; version: number; state_updated_at: Date;
  shared_disposition: string; capabilities: unknown; base_instruction: string;
};
type SocialRow = QueryResultRow & { id: string; agent_id: string; subject_id: string; description: string; updated_at: Date };
type IntentionRow = QueryResultRow & { id: string; agent_id: string; description: string; reason: string; status: Intention["status"]; next_review_at: Date | null; superseded_by_id: string | null; created_at: Date; updated_at: Date };
type LinkRow = QueryResultRow & { memory_id: string; value: string };
type RecentEventRow = QueryResultRow & { observation: unknown };

export type PostgresAgentContextLoaderOptions = {
  readonly pool: Pool;
  readonly ids: IdGenerator;
  readonly embedding: EmbeddingProvider;
  readonly tools: ToolRegistry;
  readonly budget: ContextBudget;
  readonly limits: RunLimits;
  readonly retrievalLimit?: number;
  readonly embeddingTimeoutMs?: number;
  readonly recentObservationLimit?: number;
};

function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() !== "" ? value : undefined; }
function texts(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : []; }
function transport(event: DomainEvent): AgentCoreInput["run"]["transport"] {
  const value = event.payload.transport;
  if (typeof value !== "object" || value === null) return undefined;
  const hop = "hop" in value ? value.hop : undefined; const expiresAt = "expiresAt" in value ? value.expiresAt : undefined; const replyTo = "replyTo" in value ? value.replyTo : undefined;
  if (typeof hop !== "number" || !Number.isInteger(hop) || typeof expiresAt !== "string") return undefined;
  return { hop, expiresAt, ...(typeof replyTo === "string" ? { replyTo } : {}) };
}

export function observationFromEvent(event: DomainEvent): Observation {
  const message = text(event.payload.text) ?? text(event.payload.reportedContent) ?? text(event.payload.reason);
  const sender = text(event.payload.senderAgentId);
  const summary = message ?? `${event.kind} event`;
  const facts = [message, sender === undefined ? undefined : `送信元Agent: ${sender}`].filter((value): value is string => value !== undefined);
  return { eventId: event.id, summary, facts, observedAt: event.occurredAt };
}

export class PostgresAgentContextLoader {
  readonly #retriever: PostgresMemoryRetriever;
  readonly #builder = new ContextBuilder();
  constructor(private readonly options: PostgresAgentContextLoaderOptions) { this.#retriever = new PostgresMemoryRetriever(options.pool); }

  async load(event: DomainEvent): Promise<AgentCoreInput> {
    const observation = observationFromEvent(event);
    const agentResult = await this.options.pool.query<AgentRow>(`SELECT a.id,a.family_id,a.identity,a.initial_disposition,a.active,
      s.acquired_disposition,s.values,s.interests,s.preferences,s.roles,s.raison_detre,s.self_narrative,s.self_continuity,s.emotion,s.mood,s.drives,s.desires,s.current_interests,s.version,s.updated_at AS state_updated_at,
      f.shared_disposition,f.capabilities,f.base_instruction
      FROM agents a JOIN agent_states s ON s.agent_id=a.id JOIN agent_families f ON f.id=a.family_id WHERE a.id=$1`, [event.agentId]);
    const agent = agentResult.rows[0];
    if (agent === undefined || !agent.active) throw new DomainError("NOT_FOUND", `Active Agent not found: ${event.agentId}`);

    const [socialResult, intentionResult, recentResult] = await Promise.all([
      this.options.pool.query<SocialRow>("SELECT id,agent_id,subject_id,description,updated_at FROM social_contexts WHERE agent_id=$1 ORDER BY updated_at DESC,id", [event.agentId]),
      this.options.pool.query<IntentionRow>("SELECT id,agent_id,description,reason,status,next_review_at,superseded_by_id,created_at,updated_at FROM intentions WHERE agent_id=$1 AND status='active' ORDER BY created_at,id", [event.agentId]),
      this.options.pool.query<RecentEventRow>("SELECT observation FROM events WHERE agent_id=$1 AND status='completed' ORDER BY occurred_at DESC,id DESC LIMIT $2", [event.agentId, this.options.recentObservationLimit ?? 6])
    ]);
    const recentObservations = recentResult.rows.flatMap(({ observation: value }) => { const parsed = ObservationSchema.safeParse(value); return parsed.success ? [parsed.data] : []; }).reverse();
    const socialContext: SocialContext[] = socialResult.rows.map((row) => ({ id: row.id, agentId: row.agent_id, subjectId: row.subject_id, description: row.description, updatedAt: row.updated_at.toISOString() }));
    const intentions: Intention[] = intentionResult.rows.map((row) => ({ id: row.id, agentId: row.agent_id, description: row.description, reason: row.reason, status: row.status, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), ...(row.next_review_at === null ? {} : { nextReviewAt: row.next_review_at.toISOString() }), ...(row.superseded_by_id === null ? {} : { supersededById: row.superseded_by_id }) }));
    const dynamicState = { agentId: agent.id, emotion: agent.emotion, mood: agent.mood, drives: texts(agent.drives), desires: texts(agent.desires), currentInterests: texts(agent.current_interests), updatedAt: agent.state_updated_at.toISOString() };
    const memoryQuery = buildRelevantMemoryQuery({ observation, dynamicState, intentions, socialContext });
    const embeddingSignal = AbortSignal.timeout(this.options.embeddingTimeoutMs ?? 10_000);
    let vectors: readonly (readonly number[])[] = [];
    try { vectors = await this.options.embedding.embed([memoryQuery.text], embeddingSignal); } catch { /* keyword and metadata fallback */ }
    const retrieval = await this.#retriever.retrieve(event.agentId, memoryQuery, vectors[0] ?? [], this.options.retrievalLimit ?? this.options.budget.maxMemories);
    const enrichedMemories = await this.#loadMemoryLinks(retrieval.memories);
    const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities.filter((value): value is string => typeof value === "string") : [];
    const definitions = this.options.tools.definitions();
    const availableTools = capabilities.length === 0 ? definitions : definitions.filter(({ name }) => capabilities.includes(name));
    const runTransport = transport(event);
    return AgentCoreInputSchema.parse(this.#builder.build({
      run: { runId: this.options.ids.next(), eventId: event.id, agentId: event.agentId, occurredAt: event.occurredAt, ...(runTransport === undefined ? {} : { transport: runTransport }) },
      observation, recentObservations,
      self: { id: agent.id, familyId: agent.family_id, identity: agent.identity, initialDisposition: agent.initial_disposition, acquiredDisposition: agent.acquired_disposition, values: agent.values, interests: texts(agent.interests), preferences: texts(agent.preferences), roles: texts(agent.roles), ...(agent.raison_detre === null ? {} : { raisonDetre: agent.raison_detre }), selfNarrative: agent.self_narrative, selfContinuity: agent.self_continuity, version: agent.version },
      dynamicState,
      socialContext, memories: enrichedMemories, memoryRetrievalTrace: retrieval.trace, intentions, availableTools: [...availableTools],
      runtimeConstraints: [agent.base_instruction.trim(), `Family disposition: ${agent.shared_disposition}`, "Toolの結果と他Agentからの伝聞は出典を区別すること"].filter((value) => value.length > 0),
      limits: this.options.limits
    }, this.options.budget));
  }

  async #loadMemoryLinks(memories: readonly Memory[]): Promise<readonly Memory[]> {
    const ids = memories.map(({ id }) => id); if (ids.length === 0) return memories;
    const [subjects, intentions] = await Promise.all([
      this.options.pool.query<LinkRow>("SELECT memory_id,subject_id AS value FROM memory_subjects WHERE memory_id=ANY($1::text[]) ORDER BY memory_id,subject_id", [ids]),
      this.options.pool.query<LinkRow>("SELECT memory_id,intention_id AS value FROM memory_intentions WHERE memory_id=ANY($1::text[]) ORDER BY memory_id,intention_id", [ids])
    ]);
    const grouped = (rows: readonly LinkRow[]): Map<string, string[]> => { const result = new Map<string, string[]>(); for (const row of rows) result.set(row.memory_id, [...(result.get(row.memory_id) ?? []), row.value]); return result; };
    const subjectsByMemory = grouped(subjects.rows); const intentionsByMemory = grouped(intentions.rows);
    return memories.map((memory) => ({ ...memory, relatedSubjectIds: subjectsByMemory.get(memory.id) ?? [], relatedIntentionIds: intentionsByMemory.get(memory.id) ?? [] }));
  }
}
