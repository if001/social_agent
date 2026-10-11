import type { Pool, QueryResultRow } from "pg";

import { ContextBuilder, type ContextBudget } from "../../application/context-builder.js";
import type { EmbeddingProvider, IdGenerator } from "../../application/ports.js";
import { AgentCoreInputSchema, AgentStateSchema, DomainError, FinalActionSchema, ObservationSchema, RecentExperienceSchema, SelfSchema, type AgentCoreInput, type BotPersona, type DomainEvent, type Memory, type Observation, type RecentExperience, type RunLimits } from "../../domain/contracts.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { buildRelevantMemoryQuery } from "../../application/memory-query.js";
import { noopLogger, type Logger } from "../../observability/logger.js";
import { PostgresMemoryRetriever } from "./postgres-memory-retriever.js";

type AgentRow = QueryResultRow & {
  id: string; family_id: string; identity: string; initial_disposition: string; active: boolean;
  disposition: string; self_story: string; commitments: unknown; concerns: unknown; relationships: unknown;
  mood: string; version: number; state_updated_at: Date;
  shared_disposition: string; base_instruction: string;
};
type LinkRow = QueryResultRow & { memory_id: string; value: string };
type RecentExperienceRow = QueryResultRow & { event_id: string; agent_id: string; event_kind: DomainEvent["kind"]; observation: unknown; occurred_at: Date; run_id: string | null; result: unknown; failure_reason: string | null; tools: unknown; progress_changed: boolean };

export type PostgresAgentContextLoaderOptions = {
  readonly pool: Pool;
  readonly ids: IdGenerator;
  readonly embedding: EmbeddingProvider;
  readonly tools: ToolRegistry;
  readonly budget: ContextBudget;
  readonly limits: RunLimits;
  readonly persona?: BotPersona;
  readonly retrievalLimit?: number;
  readonly embeddingTimeoutMs?: number;
  readonly logger?: Logger;
};

function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() !== "" ? value : undefined; }
function recentExperience(row: RecentExperienceRow, toolsRegistry: ToolRegistry, logger: Logger): RecentExperience | undefined {
  const observation = ObservationSchema.safeParse(row.observation); if (!observation.success) { logger.log("warn", "context.invalid_recent_experience", { eventId: row.event_id, runId: row.run_id, reason: "invalid-observation" }); return undefined; }
  const tools = Array.isArray(row.tools) ? row.tools : []; const steps: RecentExperience["steps"] = [];
  for (const raw of tools) if (typeof raw === "object" && raw !== null) { const value = raw as Record<string, unknown>; if (typeof value.tool === "string") steps.push({ type: "tool", name: value.tool, input: value.input, result: value.error === null || value.error === undefined ? toolsRegistry.projectResult(value.tool, value.result, "recent-experience") : { error: value.error }, ok: value.error === null || value.error === undefined }); }
  const result = typeof row.result === "object" && row.result !== null ? row.result as Record<string, unknown> : {}; const output = typeof result.output === "object" && result.output !== null ? result.output as Record<string, unknown> : {}; const action = FinalActionSchema.safeParse(output.action);
  if (action.success) steps.push({ type: "action", action: action.data }); else if (row.failure_reason !== null) steps.push({ type: "failure", reason: row.failure_reason });
  const parsed = RecentExperienceSchema.safeParse({ eventId: row.event_id, ...(row.run_id === null ? {} : { runId: row.run_id }), agentId: row.agent_id, occurredAt: row.occurred_at.toISOString(), eventKind: row.event_kind, observation: observation.data, steps, progressChanged: row.progress_changed });
  if (!parsed.success) { logger.log("warn", "context.invalid_recent_experience", { eventId: row.event_id, runId: row.run_id, reason: "invalid-experience" }); return undefined; }
  return parsed.data;
}
function transport(event: DomainEvent): AgentCoreInput["run"]["transport"] {
  const value = event.payload.transport;
  if (typeof value !== "object" || value === null) return undefined;
  const hop = "hop" in value ? value.hop : undefined; const expiresAt = "expiresAt" in value ? value.expiresAt : undefined; const replyTo = "replyTo" in value ? value.replyTo : undefined;
  if (typeof hop !== "number" || !Number.isInteger(hop) || typeof expiresAt !== "string") return undefined;
  return { hop, expiresAt, ...(typeof replyTo === "string" ? { replyTo } : {}) };
}

export function observationFromEvent(event: DomainEvent): Observation {
  const message = text(event.payload.text) ?? text(event.payload.reportedContent) ?? text(event.payload.instruction) ?? text(event.payload.reason);
  const sender = text(event.payload.senderAgentId);
  const summary = message ?? `${event.kind} event`;
  const suppliedFacts = Array.isArray(event.payload.facts) ? event.payload.facts.filter((value): value is string => typeof value === "string" && value.trim() !== "") : [];
  const facts = [message, sender === undefined ? undefined : `送信元Agent: ${sender}`, ...suppliedFacts].filter((value): value is string => value !== undefined);
  const actorId = text(event.payload.actorId) ?? sender;
  const actorType = event.payload.actorType === "human" || event.payload.actorType === "agent" || event.payload.actorType === "tool" || event.payload.actorType === "system" ? event.payload.actorType : undefined;
  const sourceType = event.payload.sourceType === "terminal" || event.payload.sourceType === "discord" || event.payload.sourceType === "agent" || event.payload.sourceType === "tool" || event.payload.sourceType === "scheduler" || event.payload.sourceType === "system" ? event.payload.sourceType : "unknown";
  const provenance = typeof event.payload.provenance === "object" && event.payload.provenance !== null ? event.payload.provenance as Record<string, unknown> : undefined;
  return { eventId: event.id, summary, facts, observedAt: event.occurredAt, kind: event.kind, ...(actorId === undefined ? {} : { actor: { id: actorId, type: actorType ?? "unknown" } }), source: { type: sourceType, ...(typeof event.payload.sourceId === "string" ? { id: event.payload.sourceId } : {}), direct: event.kind !== "external" && event.kind !== "tool-result" }, content: event.payload, context: { transport: event.payload.transport ?? null }, ...(provenance === undefined ? {} : { provenance }), ...(event.causationId === undefined ? {} : { causationId: event.causationId }), ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }) };
}

export class PostgresAgentContextLoader {
  readonly #retriever: PostgresMemoryRetriever;
  readonly #builder: ContextBuilder;
  constructor(private readonly options: PostgresAgentContextLoaderOptions) { this.#retriever = new PostgresMemoryRetriever(options.pool); this.#builder = new ContextBuilder(options.logger); }

  async load(event: DomainEvent): Promise<AgentCoreInput> {
    const observation = observationFromEvent(event);
    const agentResult = await this.options.pool.query<AgentRow>(`SELECT a.id,a.family_id,a.identity,a.initial_disposition,a.active,
      s.disposition,s.self_story,s.commitments,s.concerns,s.relationships,s.mood,s.version,s.updated_at AS state_updated_at,
      f.shared_disposition,f.base_instruction
      FROM agents a JOIN agent_states s ON s.agent_id=a.id JOIN agent_families f ON f.id=a.family_id WHERE a.id=$1`, [event.agentId]);
    const agent = agentResult.rows[0];
    if (agent === undefined || !agent.active) throw new DomainError("NOT_FOUND", `Active Agent not found: ${event.agentId}`);

    const recentExperienceResult = await this.options.pool.query<RecentExperienceRow>(`WITH recent_events AS (
          SELECT id,agent_id,kind,observation,occurred_at FROM events WHERE agent_id=$1 AND kind<>'tool-result' ORDER BY occurred_at DESC,id DESC LIMIT 8
        ) SELECT e.id AS event_id,e.agent_id,e.kind AS event_kind,e.observation,e.occurred_at,r.id AS run_id,r.result,r.failure_reason,
          COALESCE(t.tools,'[]'::jsonb) AS tools,
          COALESCE(EXISTS(SELECT 1 FROM state_changes sc WHERE sc.run_id=r.id AND sc.target='concerns' AND sc.before IS DISTINCT FROM sc.after),false) AS progress_changed
        FROM recent_events e
        LEFT JOIN LATERAL (SELECT id,result,failure_reason FROM agent_runs WHERE event_id=e.id AND agent_id=e.agent_id AND finished_at IS NOT NULL ORDER BY started_at DESC,id DESC LIMIT 1) r ON true
        LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('tool',x.tool,'input',x.input,'result',x.result,'error',x.error) ORDER BY x.started_at,x.id) AS tools FROM tool_executions x WHERE x.run_id=r.id) t ON true
        ORDER BY e.occurred_at,e.id`, [event.agentId]);
    const recentExperiences = recentExperienceResult.rows.flatMap((row) => { const value = recentExperience(row, this.options.tools, this.options.logger ?? noopLogger); return value === undefined ? [] : [value]; });
    const state = { agentId: agent.id, updatedAt: agent.state_updated_at.toISOString(), ...AgentStateSchema.parse({ mood: agent.mood, concerns: agent.concerns, relationships: agent.relationships }) };
    const memoryQuery = buildRelevantMemoryQuery({ observation, state });
    const embeddingSignal = AbortSignal.timeout(this.options.embeddingTimeoutMs ?? 10_000);
    let vectors: readonly (readonly number[])[] = [];
    try { vectors = await this.options.embedding.embed([memoryQuery.text], embeddingSignal); } catch { /* keyword and metadata fallback */ }
    const retrieval = await this.#retriever.retrieve(event.agentId, memoryQuery, vectors[0] ?? [], this.options.retrievalLimit ?? this.options.budget.maxMemories);
    const enrichedMemories = await this.#loadMemoryLinks(retrieval.memories);
    const availableTools = this.options.tools.definitions();
    const runTransport = transport(event);
    const built = AgentCoreInputSchema.parse(this.#builder.build({
      run: { runId: this.options.ids.next(), eventId: event.id, agentId: event.agentId, occurredAt: event.occurredAt, ...(runTransport === undefined ? {} : { transport: runTransport }) },
      observation, recentExperiences,
      ...(this.options.persona === undefined ? {} : { persona: this.options.persona }),
      currentSelf: { agentId: agent.id, version: agent.version, ...SelfSchema.parse({ identity: agent.identity, disposition: agent.disposition, selfStory: agent.self_story, commitments: agent.commitments }) },
      state,
      memories: enrichedMemories, memoryRetrievalTrace: retrieval.trace, availableTools: [...availableTools],
      runtimeConstraints: [agent.base_instruction.trim(), "Toolの結果と他Agentからの伝聞は出典を区別すること"].filter((value) => value.length > 0),
      limits: this.options.limits
    }, this.options.budget));
    return built;
  }

  async #loadMemoryLinks(memories: readonly Memory[]): Promise<readonly Memory[]> {
    const ids = memories.map(({ id }) => id); if (ids.length === 0) return memories;
    const subjects = await this.options.pool.query<LinkRow>("SELECT memory_id,subject_id AS value FROM memory_subjects WHERE memory_id=ANY($1::text[]) ORDER BY memory_id,subject_id", [ids]);
    const grouped = (rows: readonly LinkRow[]): Map<string, string[]> => { const result = new Map<string, string[]>(); for (const row of rows) result.set(row.memory_id, [...(result.get(row.memory_id) ?? []), row.value]); return result; };
    const subjectsByMemory = grouped(subjects.rows);
    return memories.map((memory) => ({ ...memory, relatedSubjectIds: subjectsByMemory.get(memory.id) ?? [] }));
  }

}
