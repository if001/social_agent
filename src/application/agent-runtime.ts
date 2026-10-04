import { z } from "zod";

import type { AgentHarness, IdGenerator, MessageQueue } from "./ports.js";
import { StateUpdateService, type StateUpdateResult } from "./state-update-service.js";
import { DomainError, type AgentAction, type AgentCoreInput, type AgentRunResult, type DomainEvent, type MessageEnvelope, type ToolExecutionRecord } from "../domain/contracts.js";

const IncomingPayload = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user-message"), text: z.string().min(1), actorId: z.string().min(1).optional(), actorType: z.enum(["human", "agent"]).optional(), sourceType: z.enum(["terminal", "discord"]).optional(), sourceId: z.string().min(1).optional(), replyContext: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal("agent-message"), senderAgentId: z.string().min(1), content: z.string().min(1), provenance: z.record(z.string(), z.unknown()) })
]);

export type PendingOutput = { readonly envelope: MessageEnvelope };
export interface RuntimePersistence {
  hasReceipt(destination: string, messageId: string): Promise<boolean>;
  loadInput(event: DomainEvent): Promise<AgentCoreInput>;
  commit(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, result: AgentRunResult, update: StateUpdateResult, outgoing: readonly MessageEnvelope[]): Promise<"committed" | "duplicate">;
  activateTriggers(event: DomainEvent): Promise<void>;
  recordFailure(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, error: unknown, toolExecutions: readonly ToolExecutionRecord[]): Promise<void>;
  pendingOutbox(limit: number): Promise<readonly PendingOutput[]>;
  markOutboxSent(id: string): Promise<void>;
  authorizeInbound(event: DomainEvent, messageId: string, maxEventsPerMinute: number): Promise<void>;
}

export type AgentRuntimeOptions = { readonly destination: string; readonly defaultOutputDestination: string; readonly queue: MessageQueue; readonly harness: AgentHarness; readonly persistence: RuntimePersistence; readonly ids: IdGenerator; readonly now: () => Date; readonly maxHops?: number; readonly maxAttempts?: number; readonly maxEventsPerMinute?: number };

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
      return this.#execute(message, event, signal, []);
    });
  }
  #serialize<T>(work: () => Promise<T>): Promise<T> {
    const result = this.#tail.then(work, work);
    this.#tail = result.then(() => undefined, () => undefined);
    return result;
  }
  async #handle(message: MessageEnvelope, signal: AbortSignal): Promise<void> {
    if (await this.options.persistence.hasReceipt(message.destination, message.id)) return;
    const now = this.options.now();
    if (Date.parse(message.expiresAt) <= now.getTime()) throw new DomainError("VALIDATION", "Message TTL expired");
    if (message.hop > (this.options.maxHops ?? 32)) throw new DomainError("VALIDATION", "Message hop limit exceeded");
    if (message.attempt >= (this.options.maxAttempts ?? 32)) throw new DomainError("VALIDATION", "Message attempt limit exceeded");
    const payload = IncomingPayload.parse(message.payload);
    const transport = { hop: message.hop, expiresAt: message.expiresAt, ...(message.replyTo === undefined ? {} : { replyTo: message.replyTo }) };
    const inheritedCorrelation = payload.type === "agent-message" && typeof payload.provenance.correlationId === "string" ? payload.provenance.correlationId : message.id;
    const event: DomainEvent = { id: this.options.ids.next(), agentId: message.destination, kind: payload.type === "user-message" && payload.actorType !== "agent" ? "user-message" : "external", occurredAt: this.options.now().toISOString(), payload: payload.type === "user-message" ? { text: payload.text, actorId: payload.actorId ?? message.source, actorType: payload.actorType ?? "human", sourceType: payload.sourceType ?? (message.source.startsWith("discord") ? "discord" : "terminal"), ...(payload.sourceId === undefined ? {} : { sourceId: payload.sourceId }), transport } : { senderAgentId: payload.senderAgentId, actorId: payload.senderAgentId, actorType: "agent", sourceType: "agent", reportedContent: payload.content, provenance: payload.provenance, transport }, causationId: message.id, correlationId: inheritedCorrelation };
    await this.options.persistence.authorizeInbound(event, message.id, this.options.maxEventsPerMinute ?? 60);
    const outgoingDestination = payload.type === "agent-message" ? message.replyTo : message.replyTo ?? this.options.defaultOutputDestination;
    const agentReply = payload.type === "agent-message" && outgoingDestination === message.source;
    const outgoing = (action: AgentAction, input: AgentCoreInput): MessageEnvelope[] => action.type === "respond" && outgoingDestination !== undefined ? [{ id: this.options.ids.next(), destination: outgoingDestination, source: message.destination, sentAt: this.options.now().toISOString(), availableAt: this.options.now().toISOString(), expiresAt: message.expiresAt, attempt: 0, hop: message.hop + (agentReply ? 1 : 0), payload: agentReply ? { type: "agent-message", senderAgentId: event.agentId, content: action.content, provenance: { causationId: event.id, correlationId: inheritedCorrelation, runId: input.run.runId } } : { type: "agent-response", text: action.content, agentId: event.agentId, correlationId: inheritedCorrelation, ...(payload.type === "user-message" && payload.replyContext !== undefined ? { replyContext: payload.replyContext } : {}) } }] : [];
    await this.#execute(message, event, signal, outgoing);
  }
  async #execute(message: MessageEnvelope, event: DomainEvent, signal: AbortSignal, outgoingFor: readonly MessageEnvelope[] | ((action: AgentAction, input: AgentCoreInput) => readonly MessageEnvelope[])): Promise<AgentAction> {
    const input = await this.options.persistence.loadInput(event);
    let result: AgentRunResult;
    try { result = await this.options.harness.run(input, signal); }
    catch (error) {
      const toolExecutions = error instanceof DomainError && typeof error.cause === "object" && error.cause !== null && "toolExecutions" in error.cause && Array.isArray(error.cause.toolExecutions) ? error.cause.toolExecutions as ToolExecutionRecord[] : [];
      await this.options.persistence.recordFailure(message, event, input, error, toolExecutions);
      throw error;
    }
    const output = result.output;
    const update = this.#updates.apply(event.agentId, input.dynamicState, output.internalChanges.transientStateUpdates, input.socialContext, event.occurredAt);
    const outgoing = typeof outgoingFor === "function" ? outgoingFor(output.action, input) : outgoingFor;
    const committed = await this.options.persistence.commit(message, event, input, result, update, outgoing);
    if (committed === "committed") await this.options.persistence.activateTriggers(event);
    return output.action;
  }
}

export class OutboxDispatcher {
  constructor(private readonly persistence: RuntimePersistence, private readonly queue: MessageQueue) {}
  async dispatch(limit = 100): Promise<number> {
    let sent = 0;
    for (const item of await this.persistence.pendingOutbox(limit)) {
      await this.queue.publish(item.envelope);
      await this.persistence.markOutboxSent(item.envelope.id);
      sent += 1;
    }
    return sent;
  }
}
