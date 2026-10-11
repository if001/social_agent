import { z } from "zod";

import type { AgentHarness, IdGenerator, MessageQueue } from "./ports.js";
import { StateUpdateService, type StateUpdateResult } from "./state-update-service.js";
import { DomainError, type AgentAction, type AgentCoreInput, type AgentRunResult, type DomainEvent, type MessageEnvelope, type ToolExecutionRecord } from "../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../observability/logger.js";

const IncomingPayload = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user-message"), text: z.string().min(1), actorId: z.string().min(1).optional(), actorType: z.enum(["human", "agent"]).optional(), sourceType: z.enum(["terminal", "discord"]).optional(), sourceId: z.string().min(1).optional(), replyContext: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal("agent-message"), senderAgentId: z.string().min(1), content: z.string().min(1), provenance: z.record(z.string(), z.unknown()) }),
  z.object({ type: z.literal("external-event"), text: z.string().min(1), facts: z.array(z.string().min(1)).default([]), actorId: z.string().min(1).optional(), sourceId: z.string().min(1), content: z.unknown().optional() }),
  z.object({ type: z.literal("time-event"), reason: z.string().min(1), scheduledFor: z.iso.datetime({ offset: true }).optional() }),
  z.object({ type: z.literal("system-event"), reason: z.string().min(1), change: z.record(z.string(), z.unknown()).optional() })
]);

export type PendingOutput = { readonly envelope: MessageEnvelope };
export interface RuntimePersistence {
  hasReceipt(destination: string, messageId: string): Promise<boolean>;
  loadInput(event: DomainEvent): Promise<AgentCoreInput>;
  commit(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, result: AgentRunResult, update: StateUpdateResult, outgoing: readonly MessageEnvelope[]): Promise<"committed" | "duplicate">;
  recordFailure(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, error: unknown, toolExecutions: readonly ToolExecutionRecord[]): Promise<void>;
  pendingOutbox(limit: number): Promise<readonly PendingOutput[]>;
  markOutboxSent(id: string): Promise<void>;
  authorizeInbound(event: DomainEvent, messageId: string, maxEventsPerMinute: number): Promise<void>;
}

export type AgentRuntimeOptions = { readonly destination: string; readonly defaultOutputDestination: string; readonly queue: MessageQueue; readonly harness: AgentHarness; readonly persistence: RuntimePersistence; readonly ids: IdGenerator; readonly now: () => Date; readonly logger?: Logger; readonly maxHops?: number; readonly maxAttempts?: number; readonly maxEventsPerMinute?: number };

const externalSpeech = (action: AgentAction): string | undefined => action.type === "respond" || action.type === "refuse" || action.type === "notify-no-execution" ? action.content : undefined;

export class AgentRuntime {
  readonly #updates = new StateUpdateService();
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
      const configuredDestination = typeof event.payload.destination === "string" ? event.payload.destination : this.options.defaultOutputDestination;
      const destination = configuredDestination.trim() !== "" ? configuredDestination : undefined;
      if (destination === undefined) throw new DomainError("VALIDATION", "Autonomous Event requires an owner or default destination");
      const outgoing = (action: AgentAction, input: AgentCoreInput): MessageEnvelope[] => {
        const text = externalSpeech(action);
        return text !== undefined ? [this.#responseEnvelope(message, event, input, destination, 0, event.correlationId ?? event.id, {
        type: "agent-response", text, agentId: event.agentId, autonomous: true,
        ...(typeof event.payload.replyContext === "object" && event.payload.replyContext !== null ? { replyContext: event.payload.replyContext } : {}),
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
    const kind: DomainEvent["kind"] = payload.type === "user-message" ? payload.actorType === "agent" ? "external" : "user-message" : payload.type === "time-event" ? "time" : payload.type === "system-event" ? "system" : "external";
    const eventPayload = payload.type === "user-message" ? { text: payload.text, actorId: payload.actorId ?? message.source, actorType: payload.actorType ?? "human", sourceType: payload.sourceType ?? (message.source.startsWith("discord") ? "discord" : "terminal"), ...(payload.sourceId === undefined ? {} : { sourceId: payload.sourceId }), transport }
      : payload.type === "agent-message" ? { senderAgentId: payload.senderAgentId, actorId: payload.senderAgentId, actorType: "agent", sourceType: "agent", reportedContent: payload.content, provenance: payload.provenance, transport }
      : payload.type === "external-event" ? { text: payload.text, facts: payload.facts, actorId: payload.actorId ?? payload.sourceId, actorType: "system", sourceType: "system", sourceId: payload.sourceId, ...(payload.content === undefined ? {} : { content: payload.content }), transport }
      : payload.type === "time-event" ? { reason: payload.reason, sourceType: "scheduler", ...(payload.scheduledFor === undefined ? {} : { scheduledFor: payload.scheduledFor }), transport }
      : { reason: payload.reason, sourceType: "system", ...(payload.change === undefined ? {} : { change: payload.change }), transport };
    const event: DomainEvent = { id: this.options.ids.next(), agentId: message.destination, kind, occurredAt: payload.type === "time-event" && payload.scheduledFor !== undefined ? payload.scheduledFor : this.options.now().toISOString(), payload: eventPayload, causationId: actionCause, correlationId: inheritedCorrelation };
    logger.log("info", "event.created", { eventId: event.id, eventKind: event.kind, correlationId: inheritedCorrelation });
    await this.options.persistence.authorizeInbound(event, message.id, this.options.maxEventsPerMinute ?? 60);
    const outgoingDestination = payload.type === "agent-message" ? message.replyTo : message.replyTo ?? this.options.defaultOutputDestination;
    const agentReply = payload.type === "agent-message" && outgoingDestination === message.source;
    const outgoing = (action: AgentAction, input: AgentCoreInput): MessageEnvelope[] => {
      const content = externalSpeech(action);
      return content !== undefined && outgoingDestination !== undefined ? [this.#responseEnvelope(message, event, input, outgoingDestination, message.hop + (agentReply ? 1 : 0), inheritedCorrelation,
        agentReply ? { type: "agent-message", senderAgentId: event.agentId, content, provenance: { causationId: event.id, correlationId: inheritedCorrelation, runId: input.run.runId } }
          : { type: "agent-response", text: content, agentId: event.agentId, correlationId: inheritedCorrelation, action: { id: input.run.runId, type: action.type }, ...(payload.type === "user-message" && payload.replyContext !== undefined ? { replyContext: payload.replyContext } : {}) }
      )] : [];
    };
    await this.#execute(message, event, signal, outgoing);
  }
  async #execute(message: MessageEnvelope, event: DomainEvent, signal: AbortSignal, outgoingFor: readonly MessageEnvelope[] | ((action: AgentAction, input: AgentCoreInput) => readonly MessageEnvelope[])): Promise<AgentAction> {
    const startedAt = Date.now(); const eventLogger = (this.options.logger ?? noopLogger).child({ agentId: event.agentId, messageId: message.id, eventId: event.id, eventKind: event.kind, correlationId: event.correlationId });
    eventLogger.log("info", "context.loading");
    const input = await this.options.persistence.loadInput(event);
    const logger = eventLogger.child({ runId: input.run.runId });
    logger.log("info", "context.loaded", { memoryCount: input.memories.length, recentExperienceCount: input.recentExperiences.length, socialContextCount: input.socialContext.length, availableToolCount: input.availableTools.length });
    let result: AgentRunResult;
    try {
      logger.log("info", "agent_core.started");
      result = await this.options.harness.run(input, signal);
    }
    catch (error) {
      const toolExecutions = error instanceof DomainError && typeof error.cause === "object" && error.cause !== null && "toolExecutions" in error.cause && Array.isArray(error.cause.toolExecutions) ? error.cause.toolExecutions as ToolExecutionRecord[] : [];
      await this.options.persistence.recordFailure(message, event, input, error, toolExecutions);
      logger.log("error", "agent_core.failed", { ...errorLogContext(error), elapsedMs: Date.now() - startedAt, toolExecutionCount: toolExecutions.length });
      throw error;
    }
    const output = result.output;
    const autonomous = message.id.startsWith("internal:");
    const completedToolAction = result.toolExecutions.some((execution) => execution.ok);
    if (autonomous && output.action.type === "no-external-action" && !completedToolAction) {
      const error = new DomainError("VALIDATION", "Autonomous Event cannot succeed without a concrete action or notify-no-execution");
      await this.options.persistence.recordFailure(message, event, input, error, result.toolExecutions);
      throw error;
    }
    logger.log("info", "agent_core.completed", { actionType: output.action.type, elapsedMs: Date.now() - startedAt, toolExecutionCount: result.toolExecutions.length, stateProposalCount: output.internalChanges.immediateStateUpdates.length });
    const update = this.#updates.apply(event.agentId, input.dynamicState, output.internalChanges.immediateStateUpdates, input.socialContext, event.occurredAt, event.id);
    const outgoing = typeof outgoingFor === "function" ? outgoingFor(output.action, input) : outgoingFor;
    const committed = await this.options.persistence.commit(message, event, input, result, update, outgoing);
    logger.log("info", "event.committed", { commitResult: committed, stateChangeCount: update.changes.length, outgoingCount: outgoing.length, elapsedMs: Date.now() - startedAt });
    return output.action;
  }
}

export class OutboxDispatcher {
  constructor(private readonly persistence: RuntimePersistence, private readonly queue: MessageQueue, private readonly logger: Logger = noopLogger) {}
  async dispatch(limit = 100): Promise<number> {
    let sent = 0;
    for (const item of await this.persistence.pendingOutbox(limit)) {
      const logger = this.logger.child({ messageId: item.envelope.id, destination: item.envelope.destination, correlationId: item.envelope.correlationId });
      logger.log("info", "outbox.delivery_started");
      await this.queue.publish(item.envelope);
      await this.persistence.markOutboxSent(item.envelope.id);
      logger.log("info", "outbox.delivery_completed");
      sent += 1;
    }
    return sent;
  }
}
