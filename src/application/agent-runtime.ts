import { z } from "zod";

import type { AgentHarness, IdGenerator, MessageQueue, PredictionService } from "./ports.js";
import type { MemoryUpdateHandler } from "./memory-update.js";
import type { ExperienceIntegrationSink } from "./experience-integration.js";
import { AgentStatePatchService, type AgentStatePatchResult } from "./agent-state-patch.js";
import { DomainError, type AgentAction, type AgentCoreInput, type AgentRunResult, type CurrentAgentState, type DomainEvent, type MessageEnvelope, type ToolExecutionRecord } from "../domain/contracts.js";
import { focusedConcernForIntegration } from "./focus-concern.js";
import { errorLogContext, noopLogger, type Logger } from "../observability/logger.js";
import type { CanonicalSubjectResolver } from "./canonical-subject.js";
import type { ObservationGate, ObservationGateAudit } from "./observation-gate.js";

const IncomingPayload = z.discriminatedUnion("type", [
  z.object({ type: z.literal("message-received"), text: z.string().min(1), senderKind: z.enum(["human", "peer"]), addressing: z.enum(["direct", "observed"]), actorId: z.string().min(1).optional(), peerName: z.string().min(1).max(120).optional(), sourceType: z.enum(["terminal", "discord"]).optional(), sourceId: z.string().min(1).optional(), replyContext: z.record(z.string(), z.unknown()).optional() }),
  // Compatibility readers. No current ingress writes these payloads.
  z.object({ type: z.literal("user-message"), text: z.string().min(1), actorId: z.string().min(1).optional(), actorType: z.enum(["human", "agent"]).optional(), sourceType: z.enum(["terminal", "discord"]).optional(), sourceId: z.string().min(1).optional(), replyContext: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal("agent-message"), senderAgentId: z.string().min(1), content: z.string().min(1), provenance: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("external-event"), text: z.string().min(1), facts: z.array(z.string().min(1)).default([]), actorId: z.string().min(1).optional(), sourceId: z.string().min(1), content: z.unknown().optional() }),
  z.object({ type: z.literal("time-event"), reason: z.string().min(1), scheduledFor: z.iso.datetime({ offset: true }).optional() }),
  z.object({ type: z.literal("system-event"), reason: z.string().min(1), change: z.record(z.string(), z.unknown()).optional() })
]);

export type PendingOutput = { readonly envelope: MessageEnvelope };
export type RuntimeExecutionInput = AgentCoreInput & { readonly persistentState: CurrentAgentState };
export interface RuntimePersistence {
  hasReceipt(destination: string, messageId: string): Promise<boolean>;
  loadInput(event: DomainEvent): Promise<AgentCoreInput | RuntimeExecutionInput>;
  claimObservationGate(destination: string, messageId: string): Promise<boolean>;
  releaseObservationGate(destination: string, messageId: string): Promise<void>;
  commit(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, result: AgentRunResult, update: AgentStatePatchResult, outgoing: readonly MessageEnvelope[], subjectIds?: readonly string[], observationGate?: ObservationGateAudit, receiptPreclaimed?: boolean): Promise<"committed" | "duplicate">;
  recordIgnoredObservation(message: MessageEnvelope, event: DomainEvent, gate: ObservationGateAudit, subjectIds?: readonly string[], receiptPreclaimed?: boolean): Promise<"committed" | "duplicate">;
  recordFailure(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, error: unknown, toolExecutions: readonly ToolExecutionRecord[], observationGate?: ObservationGateAudit): Promise<void>;
  pendingOutbox(limit: number): Promise<readonly PendingOutput[]>;
  markOutboxSent(id: string): Promise<void>;
  authorizeInbound(event: DomainEvent, messageId: string, maxEventsPerMinute: number): Promise<void>;
}

export type AgentRuntimeOptions = { readonly destination: string; readonly defaultOutputDestination: string; readonly queue: MessageQueue; readonly harness: AgentHarness; readonly persistence: RuntimePersistence; readonly ids: IdGenerator; readonly now: () => Date; readonly ownerDiscordUserId?: string; readonly logger?: Logger; readonly maxHops?: number; readonly maxAttempts?: number; readonly maxEventsPerMinute?: number; readonly prediction?: PredictionService; readonly memoryUpdateHandler?: MemoryUpdateHandler; readonly experienceIntegration?: ExperienceIntegrationSink; readonly observationGate?: ObservationGate; readonly subjects?: CanonicalSubjectResolver };

const externalSpeech = (action: AgentAction): string | undefined => (action.type === "respond" ? action.content : action.type === "refuse" || action.type === "notify-no-execution" ? action.content : undefined);
const channelContext = (value: unknown): { readonly channelId: string } | undefined => {
  if (typeof value !== "object" || value === null) return undefined;
  const channelId: unknown = (value as Record<string, unknown>).channelId;
  return typeof channelId === "string" ? { channelId } : undefined;
};

export class AgentRuntime {
  readonly #updates = new AgentStatePatchService();
  #tail: Promise<void> = Promise.resolve();
  constructor(private readonly options: AgentRuntimeOptions) {}
  start(signal: AbortSignal): Promise<void> {
    return this.options.queue.subscribe(this.options.destination, (message) => this.#serialize(() => this.#handle(message, signal)), signal);
  }
  async drain(): Promise<void> { await this.#tail; }
  process(event: DomainEvent, signal: AbortSignal): Promise<AgentAction> {
    return this.#serialize(async () => {
      const occurredAt = new Date(event.occurredAt);
      const message: MessageEnvelope = { id: `internal:${event.id}`, destination: event.agentId, source: "scheduler", sentAt: occurredAt.toISOString(), availableAt: occurredAt.toISOString(), expiresAt: new Date(occurredAt.getTime() + 86_400_000).toISOString(), attempt: 0, hop: 0, payload: { type: "internal-event", eventId: event.id } };
      if (await this.options.persistence.hasReceipt(message.destination, message.id)) return { type: "no-external-action", reason: "Internal Event was already committed" };
      const configuredDestination = typeof event.payload.destination === "string" ? event.payload.destination : this.options.defaultOutputDestination;
      const destination = configuredDestination.trim() !== "" ? configuredDestination : undefined;
      if (destination === undefined) throw new DomainError("VALIDATION", "Autonomous Event requires an owner or default destination");
      const outgoing = (action: AgentAction, input: AgentCoreInput): MessageEnvelope[] => {
        const text = externalSpeech(action);
        const replyContext = action.type === "respond" && action.recipient === "channel" ? channelContext(event.payload.replyContext) : event.payload.replyContext;
        return text !== undefined ? [this.#responseEnvelope(message, event, input, destination, 0, event.correlationId ?? event.id, {
        type: "agent-response", text, agentId: event.agentId, autonomous: true,
        ...(action.type === "respond" && action.recipient === "user" && this.options.ownerDiscordUserId !== undefined ? { user: { discordUserId: this.options.ownerDiscordUserId } } : {}),
        ...(replyContext === undefined ? {} : { replyContext }),
        action: { id: input.run.runId, type: action.type }
      })] : [];
      };
      return this.#execute(message, event, signal, outgoing);
    });
  }
  #responseEnvelope(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, destination: string, hop: number, correlationId: string, payload: Record<string, unknown>): MessageEnvelope {
    const now = this.options.now().toISOString();
    return { id: this.options.ids.next(), destination, source: event.agentId, correlationId, causationId: input.run.runId, sentAt: now, availableAt: now, expiresAt: message.expiresAt, attempt: 0, hop, payload };
  }
  #serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(work, work);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }
  async #handle(message: MessageEnvelope, signal: AbortSignal): Promise<void> {
    const logger = (this.options.logger ?? noopLogger).child({ agentId: message.destination, messageId: message.id, correlationId: message.correlationId });
    logger.log("info", "message.received", { source: message.source, payloadType: typeof message.payload.type === "string" ? message.payload.type : "unknown", hop: message.hop, attempt: message.attempt });
    if (await this.options.persistence.hasReceipt(message.destination, message.id)) { logger.log("info", "message.duplicate_skipped"); return; }
    const now = this.options.now();
    if (Date.parse(message.expiresAt) <= now.getTime()) throw new DomainError("VALIDATION", "Message TTL expired");
    if (message.hop > (this.options.maxHops ?? 32)) throw new DomainError("VALIDATION", "Message hop limit exceeded");
    if (message.attempt >= (this.options.maxAttempts ?? 32)) throw new DomainError("VALIDATION", "Message attempt limit exceeded");
    const payload = IncomingPayload.parse(message.payload);
    const transport = { hop: message.hop, expiresAt: message.expiresAt, ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }) };
    const inheritedCorrelation = message.correlationId ?? (payload.type === "agent-message" && typeof payload.provenance.correlationId === "string" ? payload.provenance.correlationId : message.id);
    const actionCause = message.causationId ?? (payload.type === "agent-message" && typeof payload.provenance.runId === "string" ? payload.provenance.runId : message.id);
    const kind: DomainEvent["kind"] = payload.type === "message-received" || payload.type === "user-message" || payload.type === "agent-message" ? "message-received" : payload.type === "time-event" ? "time" : payload.type === "system-event" ? "system" : "external";
    const eventPayload = payload.type === "message-received" ? { text: payload.text, senderKind: payload.senderKind, addressing: payload.addressing, actorId: payload.actorId ?? message.source, actorType: payload.senderKind === "peer" ? "agent" : "human", ...(payload.peerName === undefined ? {} : { peerName: payload.peerName }), sourceType: payload.sourceType ?? (message.source.startsWith("discord") ? "discord" : "terminal"), ...(payload.sourceId === undefined ? {} : { sourceId: payload.sourceId }), ...(payload.replyContext === undefined ? {} : { replyContext: payload.replyContext }), transport }
      : payload.type === "user-message" ? { text: payload.text, senderKind: payload.actorType === "agent" ? "peer" : "human", addressing: "direct", actorId: payload.actorId ?? message.source, actorType: payload.actorType ?? "human", sourceType: payload.sourceType ?? (message.source.startsWith("discord") ? "discord" : "terminal"), ...(payload.sourceId === undefined ? {} : { sourceId: payload.sourceId }), ...(payload.replyContext === undefined ? {} : { replyContext: payload.replyContext }), transport }
      : payload.type === "agent-message" ? { text: payload.content, senderKind: "peer", addressing: "direct", senderAgentId: payload.senderAgentId, actorId: payload.senderAgentId, actorType: "agent", sourceType: "agent", provenance: payload.provenance, transport }
      : payload.type === "external-event" ? { text: payload.text, facts: payload.facts, actorId: payload.actorId ?? payload.sourceId, actorType: "system", sourceType: "system", sourceId: payload.sourceId, ...(payload.content === undefined ? {} : { content: payload.content }), transport }
      : payload.type === "time-event" ? { reason: payload.reason, sourceType: "scheduler", ...(payload.scheduledFor === undefined ? {} : { scheduledFor: payload.scheduledFor }), transport }
      : { reason: payload.reason, sourceType: "system", ...(payload.change === undefined ? {} : { change: payload.change }), transport };
    const subjectId = this.options.subjects?.resolve(typeof eventPayload.actorId === "string" ? { id: eventPayload.actorId, type: eventPayload.actorType === "human" || eventPayload.actorType === "agent" ? eventPayload.actorType : "unknown" } : undefined);
    const event: DomainEvent = { id: this.options.ids.next(), agentId: message.destination, kind, occurredAt: payload.type === "time-event" && payload.scheduledFor !== undefined ? payload.scheduledFor : this.options.now().toISOString(), payload: { ...eventPayload, ...(subjectId === undefined ? {} : { subjectId }) }, causationId: actionCause, correlationId: inheritedCorrelation };
    logger.log("info", "event.created", { eventId: event.id, eventKind: event.kind, correlationId: inheritedCorrelation });
    await this.options.persistence.authorizeInbound(event, message.id, this.options.maxEventsPerMinute ?? 60);
    const observationGate = this.options.observationGate;
    const isObservedPeer = event.payload.senderKind === "peer" && event.payload.addressing === "observed" && observationGate !== undefined;
    if (isObservedPeer && !await this.options.persistence.claimObservationGate(message.destination, message.id)) { logger.log("info", "observation_gate.duplicate_skipped"); return; }
    const gate = isObservedPeer ? await observationGate.decide(event, signal) : undefined;
    if (gate !== undefined) {
      logger.log("info", "observation_gate.completed", { eventId: event.id, decision: gate.decision, modelCalls: gate.modelCalls, retrievalCount: gate.retrievalCount, ...(gate.failureReason === undefined ? {} : { failureReason: gate.failureReason }) });
      if (gate.decision === "ignore") {
        const subject = typeof event.payload.subjectId === "string" ? event.payload.subjectId : undefined;
        await this.options.persistence.recordIgnoredObservation(message, event, gate, subject === undefined ? [] : [subject], true);
        return;
      }
    }
    const direct = event.payload.addressing !== "observed";
    const outgoingDestination = direct ? message.replyTo ?? this.options.defaultOutputDestination : this.options.defaultOutputDestination;
    const peerReply = event.payload.senderKind === "peer" && event.payload.addressing === "direct";
    const outgoing = (action: AgentAction, input: AgentCoreInput): MessageEnvelope[] => {
      const content = externalSpeech(action);
      if (content === undefined) return [];
      const eventDerivedRecipient = action.type !== "respond" || action.recipient === undefined;
      const ownerUser = action.type === "respond" && action.recipient === "user";
      const channelOnly = action.type === "respond" && (action.recipient === "channel" || (ownerUser && event.payload.senderKind !== "human"));
      const replyContext = channelOnly ? channelContext(event.payload.replyContext) : event.payload.replyContext;
      return [this.#responseEnvelope(message, event, input, outgoingDestination, message.hop + (peerReply && eventDerivedRecipient ? 1 : 0), inheritedCorrelation,
        { type: "agent-response", text: content, agentId: event.agentId, correlationId: inheritedCorrelation, action: { id: input.run.runId, type: action.type }, ...(ownerUser && event.payload.senderKind !== "human" && this.options.ownerDiscordUserId !== undefined ? { user: { discordUserId: this.options.ownerDiscordUserId } } : {}), ...(replyContext === undefined ? {} : { replyContext }) }
      )];
    };
    try { await this.#execute(message, event, signal, outgoing, gate, isObservedPeer); }
    catch (error) {
      if (isObservedPeer) await this.options.persistence.releaseObservationGate(message.destination, message.id);
      throw error;
    }
  }
  async #execute(message: MessageEnvelope, event: DomainEvent, signal: AbortSignal, outgoingFor: readonly MessageEnvelope[] | ((action: AgentAction, input: AgentCoreInput) => readonly MessageEnvelope[]), observationGate?: ObservationGateAudit, receiptPreclaimed = false): Promise<AgentAction> {
    const startedAt = Date.now(); const eventLogger = (this.options.logger ?? noopLogger).child({ agentId: event.agentId, messageId: message.id, eventId: event.id, eventKind: event.kind, correlationId: event.correlationId });
    if (event.payload.targetKind === "memory-update") {
      if (this.options.memoryUpdateHandler === undefined) throw new DomainError("VALIDATION", "MemoryUpdateHandler is not configured");
      const results = await this.options.memoryUpdateHandler.handle(event);
      eventLogger.log("info", "memory_update.completed", { intentCount: results.length, elapsedMs: Date.now() - startedAt });
      return { type: "no-external-action", reason: "MemoryUpdate was applied without an Agent Action" };
    }
    eventLogger.log("info", "context.loading");
    const loaded = await this.options.persistence.loadInput(event);
    // Runtime-only state must never cross the Agent Core boundary.  In
    // particular, Experience Integration persists and later strictly parses
    // `input` as AgentCoreInput when retrying a pending integration.
    let input: AgentCoreInput = "persistentState" in loaded
      ? (() => { const coreInput = { ...loaded }; Reflect.deleteProperty(coreInput, "persistentState"); return coreInput; })()
      : loaded;
    if (input.conversation === undefined && observationGate?.decision === "engage") input = { ...input, conversation: { goal: observationGate.conversationGoal, status: "candidate" } };
    const persistentState = "persistentState" in loaded ? loaded.persistentState : input.state;
    const logger = eventLogger.child({ runId: input.run.runId });
    logger.log("info", "context.loaded", { memoryCount: input.memories.length, recentExperienceCount: input.recentExperiences.length, relationshipCount: input.state.relationships.length, availableToolCount: input.availableTools.length });
    let result: AgentRunResult;
    try {
      logger.log("info", "agent_core.started");
      result = await this.options.harness.run(input, signal);
    }
    catch (error) {
      const toolExecutions = error instanceof DomainError && typeof error.cause === "object" && error.cause !== null && "toolExecutions" in error.cause && Array.isArray(error.cause.toolExecutions) ? error.cause.toolExecutions as ToolExecutionRecord[] : [];
      await this.options.persistence.recordFailure(message, event, input, error, toolExecutions, observationGate);
      logger.log("error", "agent_core.failed", { ...errorLogContext(error), elapsedMs: Date.now() - startedAt, toolExecutionCount: toolExecutions.length });
      throw error;
    }
    const output = result.output;
    logger.log("info", "agent_core.completed", { actionType: output.action.type, elapsedMs: Date.now() - startedAt, toolExecutionCount: result.toolExecutions.length, stateProposalCount: result.concernProposals?.length ?? 0 });
    const patched = this.#updates.initial(event.agentId, persistentState);
    const update = this.#updates.applyConcernProposals(patched, result.concernProposals ?? [], event.id, () => this.options.ids.next());
    const outgoing = typeof outgoingFor === "function" ? outgoingFor(output.action, input) : outgoingFor;
    const subject = typeof event.payload.subjectId === "string" ? event.payload.subjectId : undefined;
    const committed = await this.options.persistence.commit(message, event, input, result, update, outgoing, subject === undefined ? [] : [subject], observationGate, receiptPreclaimed);
    logger.log("info", "event.committed", { commitResult: committed, stateChangeCount: update.changes.length, outgoingCount: outgoing.length, elapsedMs: Date.now() - startedAt });
    if (committed === "committed" && this.options.experienceIntegration !== undefined) {
      const focus = focusedConcernForIntegration(result, persistentState.concerns);
      try { await this.options.experienceIntegration.enqueue({ agentId: event.agentId, sourceEvent: event, sourceRunId: input.run.runId, input, result, ...(focus === undefined ? {} : { focusConcern: { concernId: focus.id, description: focus.description, whyItMatters: focus.whyItMatters } }) }); }
      catch (error) { logger.log("warn", "experience_integration.enqueue_failed_after_commit", { ...errorLogContext(error) }); }
    }
    if (committed === "committed" && this.options.prediction !== undefined) {
      const predictionStartedAt = Date.now();
      try {
        await this.options.prediction.afterResponse({ event, input, result }, signal);
      } catch (error) {
        logger.log("warn", "prediction.failed_after_commit", { elapsedMs: Date.now() - predictionStartedAt, ...errorLogContext(error) });
      }
    }
    return output.action;
  }
}

export class OutboxDispatcher {
  constructor(private readonly persistence: RuntimePersistence, private readonly queue: MessageQueue, private readonly logger: Logger = noopLogger) {}
  async dispatch(limit = 100): Promise<number> {
    const loadStartedAt = Date.now();
    let pending: readonly PendingOutput[];
    try {
      pending = await this.persistence.pendingOutbox(limit);
    } catch (error) {
      this.logger.log("error", "outbox.pending_load_failed", { operation: "database-select", elapsedMs: Date.now() - loadStartedAt, ...errorLogContext(error) });
      throw error;
    }
    let sent = 0;
    for (const item of pending) {
      const logger = this.logger.child({ messageId: item.envelope.id, destination: item.envelope.destination, correlationId: item.envelope.correlationId });
      logger.log("info", "outbox.delivery_started");
      const publishStartedAt = Date.now();
      try {
        await this.queue.publish(item.envelope);
      } catch (error) {
        logger.log("error", "outbox.queue_publish_failed", { operation: "queue-publish", elapsedMs: Date.now() - publishStartedAt, ...errorLogContext(error) });
        throw error;
      }
      const markStartedAt = Date.now();
      try {
        await this.persistence.markOutboxSent(item.envelope.id);
      } catch (error) {
        logger.log("error", "outbox.sent_mark_failed", { operation: "database-update", elapsedMs: Date.now() - markStartedAt, ...errorLogContext(error) });
        throw error;
      }
      logger.log("info", "outbox.delivery_completed", { elapsedMs: Date.now() - publishStartedAt });
      sent += 1;
    }
    return sent;
  }
}
