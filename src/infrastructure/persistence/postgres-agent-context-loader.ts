import type { Pool, QueryResultRow } from "pg";

import { ContextBuilder, type ContextBudget } from "../../application/context-builder.js";
import type { EmbeddingProvider, IdGenerator } from "../../application/ports.js";
import { AgentCoreInputSchema, AgentStateSchema, DomainError, EventAssessmentSchema, FinalActionSchema, ObservationSchema, PreviousAssessmentSchema, RecentExperienceSchema, SelfSchema, type AgentCoreInput, type BotPersona, type DomainEvent, type Observation, type PreviousAssessment, type RecentExperience, type RecentObservation, type RunLimits } from "../../domain/contracts.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { noopLogger, type Logger } from "../../observability/logger.js";

type AgentRow = QueryResultRow & {
  id: string; family_id: string; identity: string; initial_disposition: string; active: boolean;
  disposition: string; self_story: string; commitments: unknown; concerns: unknown; relationships: unknown;
  mood: string; version: number; state_updated_at: Date;
  shared_disposition: string; base_instruction: string;
};
type RecentExperienceRow = QueryResultRow & { event_id: string; agent_id: string; event_kind: DomainEvent["kind"]; observation: unknown; occurred_at: Date; run_id: string | null; result: unknown; failure_reason: string | null; tools: unknown; progress_changed: boolean };
type PreviousAssessmentRow = QueryResultRow & { occurred_at: Date; result: unknown };

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
const boundedText = (value: string, limit: number): string => value.length <= limit ? value : `${value.slice(0, limit)}…`;
function recentObservation(value: Observation): RecentObservation {
  const facts = value.facts.filter((fact) => fact !== value.summary).slice(0, 4).map((fact) => boundedText(fact, 240));
  const raw = typeof value.content === "object" && value.content !== null ? value.content as Record<string, unknown> : {};
  const schedulerContent = value.source?.type === "scheduler" ? {
    ...(typeof raw.targetKind === "string" ? { targetKind: raw.targetKind } : {}),
    ...(Array.isArray(raw.explorationCandidates) ? { explorationCandidates: raw.explorationCandidates.filter((item): item is string => typeof item === "string").slice(0, 8).map((item) => boundedText(item, 120)) } : {})
  } : undefined;
  return { summary: boundedText(value.summary, 800), facts, ...(value.kind === undefined ? {} : { kind: value.kind }), ...(value.actor === undefined ? {} : { actor: value.actor }), ...(value.source === undefined ? {} : { source: value.source }), ...(schedulerContent === undefined ? {} : { scheduler: schedulerContent }) };
}
function recentAction(value: ReturnType<typeof FinalActionSchema.parse>): ReturnType<typeof FinalActionSchema.parse> {
  if (value.type === "respond") return { ...value, content: boundedText(value.content, 1_000) };
  if (value.type === "refuse") return { ...value, content: boundedText(value.content, 1_000), reason: boundedText(value.reason, 400) };
  if (value.type === "notify-no-execution") return { ...value, content: boundedText(value.content, 800), reason: boundedText(value.reason, 400) };
  return { ...value, reason: boundedText(value.reason, 400) };
}
function recentExperience(row: RecentExperienceRow, toolsRegistry: ToolRegistry, logger: Logger): RecentExperience | undefined {
  const observation = ObservationSchema.safeParse(row.observation); if (!observation.success) { logger.log("warn", "context.invalid_recent_experience", { eventId: row.event_id, runId: row.run_id, reason: "invalid-observation" }); return undefined; }
  const tools = Array.isArray(row.tools) ? row.tools : []; const steps: RecentExperience["steps"] = [];
  for (const raw of tools) if (typeof raw === "object" && raw !== null) { const value = raw as Record<string, unknown>; if (typeof value.tool === "string") steps.push({ type: "tool", name: value.tool, input: toolsRegistry.projectInput(value.input), result: value.error === null || value.error === undefined ? toolsRegistry.projectResult(value.tool, value.result, "recent-experience") : { error: boundedText(typeof value.error === "string" ? value.error : JSON.stringify(value.error), 400) }, ok: value.error === null || value.error === undefined }); }
  const result = typeof row.result === "object" && row.result !== null ? row.result as Record<string, unknown> : {}; const output = typeof result.output === "object" && result.output !== null ? result.output as Record<string, unknown> : {}; const action = FinalActionSchema.safeParse(output.action);
  if (action.success) steps.push({ type: "action", action: recentAction(action.data) }); else if (row.failure_reason !== null) steps.push({ type: "failure", reason: boundedText(row.failure_reason, 400) });
  const parsed = RecentExperienceSchema.safeParse({ eventId: row.event_id, ...(row.run_id === null ? {} : { runId: row.run_id }), agentId: row.agent_id, occurredAt: row.occurred_at.toISOString(), eventKind: row.event_kind, observation: recentObservation(observation.data), steps, progressChanged: row.progress_changed });
  if (!parsed.success) { logger.log("warn", "context.invalid_recent_experience", { eventId: row.event_id, runId: row.run_id, reason: "invalid-experience" }); return undefined; }
  return parsed.data;
}
function previousAssessment(row: PreviousAssessmentRow | undefined): PreviousAssessment | undefined {
  if (row === undefined || typeof row.result !== "object" || row.result === null) return undefined;
  const result = row.result as Record<string, unknown>;
  const assessment = EventAssessmentSchema.safeParse(result.assessment);
  if (assessment.success) return PreviousAssessmentSchema.parse({ occurredAt: row.occurred_at.toISOString(), ...assessment.data });
  return undefined;
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
  readonly #builder: ContextBuilder;
  constructor(private readonly options: PostgresAgentContextLoaderOptions) { this.#builder = new ContextBuilder(options.logger); }

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
    const previousAssessmentResult = await this.options.pool.query<PreviousAssessmentRow>(`SELECT e.occurred_at,r.result
        FROM agent_runs r JOIN events e ON e.id=r.event_id AND e.agent_id=r.agent_id
        WHERE r.agent_id=$1 AND r.finished_at IS NOT NULL AND r.failure_reason IS NULL AND r.result ? 'assessment'
        ORDER BY e.occurred_at DESC,e.id DESC,r.started_at DESC,r.id DESC LIMIT 1`, [event.agentId]);
    const recentExperiences = recentExperienceResult.rows.flatMap((row) => { const value = recentExperience(row, this.options.tools, this.options.logger ?? noopLogger); return value === undefined ? [] : [value]; });
    const priorAssessment = previousAssessment(previousAssessmentResult.rows[0]);
    const state = { agentId: agent.id, updatedAt: agent.state_updated_at.toISOString(), ...AgentStateSchema.parse({ mood: agent.mood, concerns: agent.concerns, relationships: agent.relationships }) };
    const availableTools = this.options.tools.definitions();
    const runTransport = transport(event);
    const built = AgentCoreInputSchema.parse(this.#builder.build({
      run: { runId: this.options.ids.next(), eventId: event.id, agentId: event.agentId, occurredAt: event.occurredAt, ...(runTransport === undefined ? {} : { transport: runTransport }) },
      observation, recentExperiences,
      ...(priorAssessment === undefined ? {} : { previousAssessment: priorAssessment }),
      ...(this.options.persona === undefined ? {} : { persona: this.options.persona }),
      currentSelf: { agentId: agent.id, version: agent.version, ...SelfSchema.parse({ identity: agent.identity, disposition: agent.disposition, selfStory: agent.self_story, commitments: agent.commitments }) },
      state,
      memories: [], memoryRetrievalTrace: [], availableTools: [...availableTools],
      runtimeConstraints: [agent.base_instruction.trim(), "Toolの結果と他Agentからの伝聞は出典を区別すること"].filter((value) => value.length > 0),
      limits: this.options.limits
    }, this.options.budget));
    return built;
  }

}
