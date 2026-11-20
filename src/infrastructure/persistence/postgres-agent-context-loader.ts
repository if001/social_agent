import { and, asc, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";

import { ContextBuilder, type ContextBudget } from "../../application/context-builder.js";
import type { RuntimeExecutionInput } from "../../application/agent-runtime.js";
import type { EmbeddingProvider, IdGenerator, RetrievalService } from "../../application/ports.js";
import type { PredictionRepository } from "../../application/prediction.js";
import { AgentCoreInputSchema, AgentStateSchema, DomainError, EventAssessmentSchema, FinalActionSchema, G3OutputSchema, ObservationSchema, PersistedSelfSchema, PreviousAssessmentSchema, PreviousDesireSchema, RecentExperienceSchema, type AgentCoreInput, type BotPersona, type DomainEvent, type Observation, type PreviousAssessment, type PreviousDesire, type RecentExperience, type RecentObservation, type RunLimits } from "../../domain/contracts.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { noopLogger, type Logger } from "../../observability/logger.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { agentFamilies, agentRuns, agents, agentStates, events, stateChanges, toolExecutions } from "./schema.js";

type AgentRow = {
  id: string; family_id: string; identity: string; initial_disposition: string; active: boolean;
  disposition: string; self_story: string; commitments: unknown; concerns: unknown; relationships: unknown;
  mood: string; version: number; state_updated_at: Date;
  shared_disposition: string; base_instruction: string;
};
type RecentExperienceRow = { event_id: string; agent_id: string; event_kind: DomainEvent["kind"]; observation: unknown; occurred_at: Date; run_id: string | null; result: unknown; failure_reason: string | null; tools: unknown; progress_changed: boolean };
type PreviousAssessmentRow = { occurred_at: Date; result: unknown };
type PreviousDesireRow = { occurred_at: Date; result: unknown };

export type PostgresAgentContextLoaderOptions = {
  readonly database: RuntimeDatabase;
  readonly ids: IdGenerator;
  readonly embedding: EmbeddingProvider;
  readonly tools: ToolRegistry;
  readonly budget: ContextBudget;
  readonly limits: RunLimits;
  readonly persona?: BotPersona;
  readonly predictionRepository?: PredictionRepository;
  readonly retrievalService?: RetrievalService;
  readonly retrievalLimit?: number;
  readonly embeddingTimeoutMs?: number;
  readonly logger?: Logger;
};

function text(value: unknown): string | undefined { return typeof value === "string" && value.trim() !== "" ? value : undefined; }
const boundedText = (value: string, limit: number): string => value.length <= limit ? value : `${value.slice(0, limit)}…`;
function recentObservation(value: Observation): RecentObservation {
  const visible = modelObservationForAgentCore(value);
  const facts = visible.facts.filter((fact) => fact !== visible.summary).slice(0, 4).map((fact) => boundedText(fact, 240));
  const raw = typeof visible.content === "object" && visible.content !== null ? visible.content as Record<string, unknown> : {};
  const schedulerContent = visible.source?.type === "scheduler" ? {
    ...(typeof raw.targetKind === "string" ? { targetKind: raw.targetKind } : {}),
    ...(Array.isArray(raw.explorationCandidates) ? { explorationCandidates: raw.explorationCandidates.filter((item): item is string => typeof item === "string").slice(0, 8).map((item) => boundedText(item, 120)) } : {})
  } : undefined;
  return { summary: boundedText(visible.summary, 800), facts, ...(visible.kind === undefined ? {} : { kind: visible.kind }), ...(visible.source === undefined ? {} : { source: visible.source }), ...(schedulerContent === undefined ? {} : { scheduler: schedulerContent }) };
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

function previousDesire(row: PreviousDesireRow | undefined): PreviousDesire | undefined {
  if (row === undefined || typeof row.result !== "object" || row.result === null) return undefined;
  const result = row.result as Record<string, unknown>;
  const output = typeof result.output === "object" && result.output !== null ? result.output as Record<string, unknown> : undefined;
  if (output === undefined || typeof output.desire !== "string" || output.desire.trim() === "") return undefined;
  return PreviousDesireSchema.parse({ desire: output.desire, occurredAt: row.occurred_at.toISOString() });
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

/** Event audit keeps transport identifiers; Agent Core only receives their semantic view. */
/** Removes transport identities and audit-only payload from the Agent Core view. */
export function modelObservationForAgentCore(value: Observation): Observation {
  const scheduler = typeof value.content === "object" && value.content !== null
    ? (() => { const raw = value.content as Record<string, unknown>; return value.source?.type === "scheduler" && typeof raw.targetKind === "string" ? { targetKind: raw.targetKind } : undefined; })()
    : undefined;
  return ObservationSchema.parse({ eventId: value.eventId, summary: value.summary, facts: value.facts.filter((fact) => !fact.startsWith("送信元Agent:")), observedAt: value.observedAt,
    ...(value.kind === undefined ? {} : { kind: value.kind }),
    ...(value.source === undefined ? {} : { source: { type: value.source.type, direct: value.source.direct } }),
    ...(scheduler === undefined ? {} : { content: scheduler }) });
}

export class PostgresAgentContextLoader {
  readonly #builder: ContextBuilder;
  constructor(private readonly options: PostgresAgentContextLoaderOptions) { this.#builder = new ContextBuilder(options.logger); }

  async load(event: DomainEvent): Promise<RuntimeExecutionInput> {
    const auditedObservation = observationFromEvent(event);
    const observation = modelObservationForAgentCore(auditedObservation);
    const agent = (await this.options.database.db.select({
      id: agents.id, family_id: agents.familyId, identity: agents.identity,
      initial_disposition: agents.initialDisposition, active: agents.active,
      disposition: agentStates.disposition, self_story: agentStates.selfStory,
      commitments: agentStates.commitments, concerns: agentStates.concerns,
      relationships: agentStates.relationships, mood: agentStates.mood,
      version: agentStates.version, state_updated_at: agentStates.updatedAt,
      shared_disposition: agentFamilies.sharedDisposition, base_instruction: agentFamilies.baseInstruction
    }).from(agents).innerJoin(agentStates, eq(agentStates.agentId, agents.id))
      .innerJoin(agentFamilies, eq(agentFamilies.id, agents.familyId))
      .where(eq(agents.id, event.agentId)).limit(1))[0] as AgentRow | undefined;
    if (agent === undefined || !agent.active) throw new DomainError("NOT_FOUND", `Active Agent not found: ${event.agentId}`);

    const recentEvents = await this.options.database.db.select().from(events).where(and(
      eq(events.agentId, event.agentId), ne(events.kind, "tool-result")
    )).orderBy(desc(events.occurredAt), desc(events.id)).limit(8);
    const recentRows: RecentExperienceRow[] = [];
    for (const recentEvent of recentEvents.reverse()) {
      const run = (await this.options.database.db.select().from(agentRuns).where(and(
        eq(agentRuns.eventId, recentEvent.id), eq(agentRuns.agentId, recentEvent.agentId),
        isNotNull(agentRuns.finishedAt)
      )).orderBy(desc(agentRuns.startedAt), desc(agentRuns.id)).limit(1))[0];
      const tools = run === undefined ? [] : await this.options.database.db.select({
        tool: toolExecutions.tool, input: toolExecutions.input,
        result: toolExecutions.result, error: toolExecutions.error
      }).from(toolExecutions).where(eq(toolExecutions.runId, run.id))
        .orderBy(asc(toolExecutions.startedAt), asc(toolExecutions.id));
      const progress = run === undefined ? [] : await this.options.database.db.select({ id: stateChanges.id }).from(stateChanges).where(and(
        eq(stateChanges.runId, run.id), eq(stateChanges.target, "concerns"),
        sql`${stateChanges.before} IS DISTINCT FROM ${stateChanges.after}`
      )).limit(1);
      recentRows.push({ event_id: recentEvent.id, agent_id: recentEvent.agentId, event_kind: recentEvent.kind as DomainEvent["kind"], observation: recentEvent.observation, occurred_at: recentEvent.occurredAt, run_id: run?.id ?? null, result: run?.result ?? null, failure_reason: run?.failureReason ?? null, tools, progress_changed: progress.length > 0 });
    }
    const priorBase = [eq(agentRuns.agentId, event.agentId), isNotNull(agentRuns.finishedAt), isNull(agentRuns.failureReason)];
    const [assessmentRows, desireRows] = await Promise.all([
      this.options.database.db.select({ occurred_at: events.occurredAt, result: agentRuns.result }).from(agentRuns)
        .innerJoin(events, and(eq(events.id, agentRuns.eventId), eq(events.agentId, agentRuns.agentId)))
        .where(and(...priorBase, sql`${agentRuns.result} ? 'assessment'`))
        .orderBy(desc(events.occurredAt), desc(events.id), desc(agentRuns.startedAt), desc(agentRuns.id)).limit(1),
      this.options.database.db.select({ occurred_at: events.occurredAt, result: agentRuns.result }).from(agentRuns)
        .innerJoin(events, and(eq(events.id, agentRuns.eventId), eq(events.agentId, agentRuns.agentId)))
        .where(and(...priorBase, sql`coalesce(${agentRuns.result} #>> '{output,desire}','') <> ''`))
        .orderBy(desc(events.occurredAt), desc(events.id), desc(agentRuns.startedAt), desc(agentRuns.id)).limit(1)
    ]);
    const recentExperiences = recentRows.flatMap((row) => { const value = recentExperience(row, this.options.tools, this.options.logger ?? noopLogger); return value === undefined ? [] : [value]; });
    const priorAssessment = previousAssessment(assessmentRows[0]);
    const priorDesire = previousDesire(desireRows[0]);
    const state = { agentId: agent.id, updatedAt: agent.state_updated_at.toISOString(), ...AgentStateSchema.parse({ mood: agent.mood, concerns: agent.concerns, relationships: agent.relationships }) };
    const availableTools = this.options.tools.definitions();
    const runTransport = transport(event);
    const loadedPredictionContext = this.options.predictionRepository === undefined ? undefined : await this.options.predictionRepository.context(event.agentId);
    const basePredictionContext = loadedPredictionContext === undefined || loadedPredictionContext.memoryCandidates.length > 0 || this.options.retrievalService === undefined ? loadedPredictionContext : { ...loadedPredictionContext, memoryCandidates: [...await this.options.retrievalService.retrieve({ agentId: event.agentId, query: loadedPredictionContext.previousPrediction?.output.predictions.g2.candidates[0]?.content ?? observation.summary, scope: "all", limit: 5 }).catch(() => [])] };
    const g3Output = event.payload.targetKind === "prediction-g3-result" ? G3OutputSchema.safeParse(event.payload.output) : undefined;
    const predictionContext = g3Output?.success === true ? {
      agentId: event.agentId,
      ...(basePredictionContext?.previousPrediction === undefined ? {} : { previousPrediction: basePredictionContext.previousPrediction }),
      g3Summary: [...g3Output.data.newHypotheses, ...g3Output.data.findings].join("\n").slice(0, 4_000),
      g3MemoryIntents: [],
      memoryCandidates: basePredictionContext?.memoryCandidates ?? []
    } : basePredictionContext;
    const recentExperiencesWithEffect = predictionContext?.recentExperienceEffect === undefined ? recentExperiences : recentExperiences.map((item) => item.eventId === predictionContext.recentExperienceEffect?.eventId ? { ...item, effect: predictionContext.recentExperienceEffect.effect } : item);
    const built = AgentCoreInputSchema.parse(this.#builder.build({
      run: { runId: this.options.ids.next(), eventId: event.id, agentId: event.agentId, occurredAt: event.occurredAt, ...(runTransport === undefined ? {} : { transport: runTransport }) },
      observation, recentExperiences: recentExperiencesWithEffect,
      ...(priorAssessment === undefined ? {} : { previousAssessment: priorAssessment }),
      ...(priorDesire === undefined ? {} : { previousDesire: priorDesire }),
      ...(this.options.persona === undefined ? {} : { persona: this.options.persona }),
      currentSelf: { agentId: agent.id, version: agent.version, ...PersistedSelfSchema.parse({ identity: agent.identity, disposition: agent.disposition, selfStory: agent.self_story, commitments: agent.commitments }) },
      state,
      memories: [], memoryRetrievalTrace: [], ...(predictionContext === undefined ? {} : { predictionContext }), availableTools: [...availableTools],
      runtimeConstraints: [agent.base_instruction.trim(), "Toolの結果と他Agentからの伝聞は出典を区別すること"].filter((value) => value.length > 0),
      limits: this.options.limits
    }, this.options.budget));
    return { ...built, persistentState: state };
  }

}
