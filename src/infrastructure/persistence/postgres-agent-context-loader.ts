import type { Pool, QueryResultRow } from "pg";

import { ContextBuilder, type ContextBudget } from "../../application/context-builder.js";
import type { EmbeddingProvider, IdGenerator } from "../../application/ports.js";
import { AgentCoreInputSchema, DomainError, DynamicStateSchema, FinalActionSchema, MotiveExplorationSchema, MotiveSchema, ObservationSchema, RecentExperienceSchema, type AgentCoreInput, type BotPersona, type DomainEvent, type Memory, type Observation, type RecentExperience, type RunLimits, type SocialContext } from "../../domain/contracts.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { buildRelevantMemoryQuery } from "../../application/memory-query.js";
import { explicitSubjectIds, selectSocialContexts, type SelectedContext } from "../../application/context-selection.js";
import { noopLogger, type Logger } from "../../observability/logger.js";
import { PostgresMemoryRetriever } from "./postgres-memory-retriever.js";

type AgentRow = QueryResultRow & {
  id: string; family_id: string; identity: string; initial_disposition: string; active: boolean;
  acquired_disposition: string; values: string; interests: unknown; preferences: unknown; roles: unknown; raison_detre: string | null; self_narrative: string; self_continuity: string;
  mood: string; emotion: unknown; motives: unknown; motive_exploration: unknown; version: number; state_updated_at: Date;
  shared_disposition: string; base_instruction: string;
};
type SocialRow = QueryResultRow & { id: string; agent_id: string; subject_id: string; subject_type: SocialContext["subjectType"]; description: string; updated_at: Date };
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
function texts(value: unknown): string[] { return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.trim() !== "") : []; }
function motives(value: unknown) {
  const parsed = MotiveSchema.array().safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION", "Persisted motives are invalid", { cause: parsed.error });
  return parsed.data;
}
function motiveExploration(value: unknown) {
  const parsed = MotiveExplorationSchema.array().safeParse(value);
  if (!parsed.success) throw new DomainError("VALIDATION", "Persisted motive exploration is invalid", { cause: parsed.error });
  return parsed.data;
}
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
      s.acquired_disposition,s.values,s.interests,s.preferences,s.roles,s.raison_detre,s.self_narrative,s.self_continuity,s.mood,s.emotion,s.motives,s.motive_exploration,s.version,s.updated_at AS state_updated_at,
      f.shared_disposition,f.base_instruction
      FROM agents a JOIN agent_states s ON s.agent_id=a.id JOIN agent_families f ON f.id=a.family_id WHERE a.id=$1`, [event.agentId]);
    const agent = agentResult.rows[0];
    if (agent === undefined || !agent.active) throw new DomainError("NOT_FOUND", `Active Agent not found: ${event.agentId}`);

    const subjectIds = explicitSubjectIds(observation);
    const [socialResult, recentExperienceResult] = await Promise.all([
      this.options.pool.query<SocialRow>("SELECT id,agent_id,subject_id,subject_type,description,updated_at FROM social_contexts WHERE agent_id=$1 ORDER BY CASE WHEN subject_id=ANY($2::text[]) THEN 0 ELSE 1 END,updated_at DESC,id LIMIT 64", [event.agentId, subjectIds]),
      this.options.pool.query<RecentExperienceRow>(`WITH recent_events AS (
          SELECT id,agent_id,kind,observation,occurred_at FROM events WHERE agent_id=$1 AND kind<>'tool-result' ORDER BY occurred_at DESC,id DESC LIMIT 8
        ) SELECT e.id AS event_id,e.agent_id,e.kind AS event_kind,e.observation,e.occurred_at,r.id AS run_id,r.result,r.failure_reason,
          COALESCE(t.tools,'[]'::jsonb) AS tools,
          COALESCE(EXISTS(SELECT 1 FROM state_changes sc WHERE sc.run_id=r.id AND sc.target='motives' AND sc.before IS DISTINCT FROM sc.after),false) AS progress_changed
        FROM recent_events e
        LEFT JOIN LATERAL (SELECT id,result,failure_reason FROM agent_runs WHERE event_id=e.id AND agent_id=e.agent_id AND finished_at IS NOT NULL ORDER BY started_at DESC,id DESC LIMIT 1) r ON true
        LEFT JOIN LATERAL (SELECT jsonb_agg(jsonb_build_object('tool',x.tool,'input',x.input,'result',x.result,'error',x.error) ORDER BY x.started_at,x.id) AS tools FROM tool_executions x WHERE x.run_id=r.id) t ON true
        ORDER BY e.occurred_at,e.id`, [event.agentId]),
    ]);
    const recentExperiences = recentExperienceResult.rows.flatMap((row) => { const value = recentExperience(row, this.options.tools, this.options.logger ?? noopLogger); return value === undefined ? [] : [value]; });
    const socialContext: SocialContext[] = socialResult.rows.map((row) => ({ id: row.id, agentId: row.agent_id, subjectId: row.subject_id, subjectType: row.subject_type, description: row.description, updatedAt: row.updated_at.toISOString() }));
    const parsedEmotion = DynamicStateSchema.shape.emotion.safeParse(agent.emotion);
    const dynamicState = { agentId: agent.id, mood: agent.mood, ...(parsedEmotion.success && parsedEmotion.data !== undefined ? { emotion: parsedEmotion.data } : {}), motives: motives(agent.motives), motiveExploration: motiveExploration(agent.motive_exploration), updatedAt: agent.state_updated_at.toISOString() };
    const seedSocial = selectSocialContexts({ socialContext, observation });
    const memoryQuery = buildRelevantMemoryQuery({ observation, dynamicState, socialContext: seedSocial.map(({ value }) => value) });
    const embeddingSignal = AbortSignal.timeout(this.options.embeddingTimeoutMs ?? 10_000);
    let vectors: readonly (readonly number[])[] = [];
    try { vectors = await this.options.embedding.embed([memoryQuery.text], embeddingSignal); } catch { /* keyword and metadata fallback */ }
    const retrieval = await this.#retriever.retrieve(event.agentId, memoryQuery, vectors[0] ?? [], this.options.retrievalLimit ?? this.options.budget.maxMemories);
    const enrichedMemories = await this.#loadMemoryLinks(retrieval.memories);
    const linkedSubjectIds = [...new Set(enrichedMemories.flatMap(({ relatedSubjectIds }) => relatedSubjectIds))];
    const linkedSocial = await this.#loadSocialContexts(event.agentId, linkedSubjectIds);
    const socialCandidates = this.#mergeById(socialContext, linkedSocial);
    const selectedSocial = selectSocialContexts({ socialContext: socialCandidates, observation, memories: enrichedMemories });
    const availableTools = this.options.tools.definitions();
    const runTransport = transport(event);
    const built = AgentCoreInputSchema.parse(this.#builder.build({
      run: { runId: this.options.ids.next(), eventId: event.id, agentId: event.agentId, occurredAt: event.occurredAt, ...(runTransport === undefined ? {} : { transport: runTransport }) },
      observation, recentExperiences,
      ...(this.options.persona === undefined ? {} : { persona: this.options.persona }),
      self: { id: agent.id, familyId: agent.family_id, identity: agent.identity, disposition: { shared: agent.shared_disposition, initial: agent.initial_disposition, acquired: agent.acquired_disposition }, values: agent.values, interests: texts(agent.interests), preferences: texts(agent.preferences), roles: texts(agent.roles), ...(agent.raison_detre === null ? {} : { raisonDetre: agent.raison_detre }), selfNarrative: agent.self_narrative, selfContinuity: agent.self_continuity, version: agent.version },
      dynamicState,
      socialContext: selectedSocial.map(({ value }) => value), memories: enrichedMemories, memoryRetrievalTrace: retrieval.trace, availableTools: [...availableTools],
      requiredSocialContextIds: new Set(selectedSocial.filter(({ required }) => required).map(({ value }) => value.id)),
      runtimeConstraints: [agent.base_instruction.trim(), "Toolの結果と他Agentからの伝聞は出典を区別すること"].filter((value) => value.length > 0),
      limits: this.options.limits
    }, this.options.budget));
    this.#logSelection(event, observation, socialCandidates, selectedSocial, built);
    return built;
  }

  async #loadMemoryLinks(memories: readonly Memory[]): Promise<readonly Memory[]> {
    const ids = memories.map(({ id }) => id); if (ids.length === 0) return memories;
    const subjects = await this.options.pool.query<LinkRow>("SELECT memory_id,subject_id AS value FROM memory_subjects WHERE memory_id=ANY($1::text[]) ORDER BY memory_id,subject_id", [ids]);
    const grouped = (rows: readonly LinkRow[]): Map<string, string[]> => { const result = new Map<string, string[]>(); for (const row of rows) result.set(row.memory_id, [...(result.get(row.memory_id) ?? []), row.value]); return result; };
    const subjectsByMemory = grouped(subjects.rows);
    return memories.map((memory) => ({ ...memory, relatedSubjectIds: subjectsByMemory.get(memory.id) ?? [] }));
  }

  async #loadSocialContexts(agentId: string, subjectIds: readonly string[]): Promise<readonly SocialContext[]> {
    if (subjectIds.length === 0) return [];
    const result = await this.options.pool.query<SocialRow>("SELECT id,agent_id,subject_id,subject_type,description,updated_at FROM social_contexts WHERE agent_id=$1 AND subject_id=ANY($2::text[]) ORDER BY updated_at DESC,id", [agentId, subjectIds]);
    return result.rows.map((row) => ({ id: row.id, agentId: row.agent_id, subjectId: row.subject_id, subjectType: row.subject_type, description: row.description, updatedAt: row.updated_at.toISOString() }));
  }

  #mergeById<T extends { readonly id: string }>(first: readonly T[], second: readonly T[]): readonly T[] { const values = new Map(first.map((value) => [value.id, value])); for (const value of second) values.set(value.id, value); return [...values.values()]; }

  #logSelection(event: DomainEvent, observation: Observation, social: readonly SocialContext[], selectedSocial: readonly SelectedContext<SocialContext>[], built: AgentCoreInput): void {
    const explicit = new Set(explicitSubjectIds(observation)); const builtSocial = new Set(built.socialContext.map(({ id }) => id));
    const requiredSocialCount = social.filter(({ subjectId }) => explicit.has(subjectId)).length;
    (this.options.logger ?? noopLogger).log("debug", "context.selection", { agentId: event.agentId, eventId: event.id, socialContextCandidateCount: social.length, selectedSocialContexts: JSON.stringify(selectedSocial.map(({ value, reason }) => ({ id: value.id, reason }))), socialContextExclusions: JSON.stringify({ rankLimit: Math.max(0, social.length - selectedSocial.length), contextBudget: selectedSocial.filter(({ value }) => !builtSocial.has(value.id)).length }), requiredSocialContextOverflow: requiredSocialCount > 6 });
  }
}
