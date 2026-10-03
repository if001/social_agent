import type { Pool, QueryResultRow } from "pg";

import { ContextBuilder, type ContextBudget } from "../../application/context-builder.js";
import type { EmbeddingProvider, IdGenerator } from "../../application/ports.js";
import { AgentCoreInputSchema, DomainError, type AgentCoreInput, type DomainEvent, type Intention, type Memory, type Observation, type RunLimits, type SocialContext } from "../../domain/contracts.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { PostgresMemoryRetriever } from "./postgres-memory-retriever.js";

type AgentRow = QueryResultRow & {
  id: string; family_id: string; identity: string; initial_disposition: string; active: boolean;
  acquired_disposition: string; values: string; role: string; self_narrative: string; self_continuity: string;
  emotion: string; mood: string; drive: string; desire: string; version: number; state_updated_at: Date;
  shared_disposition: string; capabilities: unknown; base_instruction: string;
};
type SocialRow = QueryResultRow & { id: string; agent_id: string; subject_id: string; description: string; updated_at: Date };
type IntentionRow = QueryResultRow & { id: string; agent_id: string; description: string; reason: string; status: Intention["status"]; next_review_at: Date | null; superseded_by_id: string | null; created_at: Date; updated_at: Date };
type LinkRow = QueryResultRow & { memory_id: string; value: string };

export type PostgresAgentContextLoaderOptions = {
  readonly pool: Pool;
  readonly ids: IdGenerator;
  readonly embedding: EmbeddingProvider;
  readonly tools: ToolRegistry;
  readonly budget: ContextBudget;
  readonly limits: RunLimits;
  readonly retrievalLimit?: number;
  readonly embeddingTimeoutMs?: number;
};

function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() !== "" ? value : undefined; }
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
      s.acquired_disposition,s.values,s.role,s.self_narrative,s.self_continuity,s.emotion,s.mood,s.drive,s.desire,s.version,s.updated_at AS state_updated_at,
      f.shared_disposition,f.capabilities,f.base_instruction
      FROM agents a JOIN agent_states s ON s.agent_id=a.id JOIN agent_families f ON f.id=a.family_id WHERE a.id=$1`, [event.agentId]);
    const agent = agentResult.rows[0];
    if (agent === undefined || !agent.active) throw new DomainError("NOT_FOUND", `Active Agent not found: ${event.agentId}`);

    const embeddingSignal = AbortSignal.timeout(this.options.embeddingTimeoutMs ?? 10_000);
    const [vectors, socialResult, intentionResult] = await Promise.all([
      this.options.embedding.embed([observation.summary], embeddingSignal),
      this.options.pool.query<SocialRow>("SELECT id,agent_id,subject_id,description,updated_at FROM social_contexts WHERE agent_id=$1 ORDER BY updated_at DESC,id", [event.agentId]),
      this.options.pool.query<IntentionRow>("SELECT id,agent_id,description,reason,status,next_review_at,superseded_by_id,created_at,updated_at FROM intentions WHERE agent_id=$1 AND status='active' ORDER BY created_at,id", [event.agentId])
    ]);
    const memories = await this.#retriever.retrieve(event.agentId, observation.summary, vectors[0] ?? [], this.options.retrievalLimit ?? this.options.budget.maxMemories);
    const enrichedMemories = await this.#loadMemoryLinks(memories);
    const socialContext: SocialContext[] = socialResult.rows.map((row) => ({ id: row.id, agentId: row.agent_id, subjectId: row.subject_id, description: row.description, updatedAt: row.updated_at.toISOString() }));
    const intentions: Intention[] = intentionResult.rows.map((row) => ({ id: row.id, agentId: row.agent_id, description: row.description, reason: row.reason, status: row.status, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString(), ...(row.next_review_at === null ? {} : { nextReviewAt: row.next_review_at.toISOString() }), ...(row.superseded_by_id === null ? {} : { supersededById: row.superseded_by_id }) }));
    const capabilities = Array.isArray(agent.capabilities) ? agent.capabilities.filter((value): value is string => typeof value === "string") : [];
    const definitions = this.options.tools.definitions();
    const availableTools = capabilities.length === 0 ? definitions : definitions.filter(({ name }) => capabilities.includes(name));
    const runTransport = transport(event);
    return AgentCoreInputSchema.parse(this.#builder.build({
      run: { runId: this.options.ids.next(), eventId: event.id, agentId: event.agentId, occurredAt: event.occurredAt, ...(runTransport === undefined ? {} : { transport: runTransport }) },
      observation,
      self: { id: agent.id, familyId: agent.family_id, identity: agent.identity, initialDisposition: agent.initial_disposition, acquiredDisposition: agent.acquired_disposition, values: agent.values, role: agent.role, selfNarrative: agent.self_narrative, selfContinuity: agent.self_continuity, version: agent.version },
      dynamicState: { agentId: agent.id, emotion: agent.emotion, mood: agent.mood, drive: agent.drive, desire: agent.desire, updatedAt: agent.state_updated_at.toISOString() },
      socialContext, memories: enrichedMemories, intentions, availableTools: [...availableTools],
      runtimeConstraints: [agent.base_instruction, `Family disposition: ${agent.shared_disposition}`, "Toolの結果と他Agentからの伝聞は出典を区別すること"],
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
