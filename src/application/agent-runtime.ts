import { z } from "zod";

import type { AgentHarness, IdGenerator, MessageQueue } from "./ports.js";
import { StateUpdateService, type StateUpdateResult } from "./state-update-service.js";
import { type AgentCoreInput, type AgentCoreOutput, type DomainEvent, type MessageEnvelope } from "../domain/contracts.js";

const IncomingPayload = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user-message"), text: z.string().min(1), replyContext: z.record(z.string(), z.unknown()).optional() }),
  z.object({ type: z.literal("agent-message"), senderAgentId: z.string().min(1), content: z.string().min(1), provenance: z.record(z.string(), z.unknown()) })
]);

export type PendingOutput = { readonly envelope: MessageEnvelope };
export interface RuntimePersistence {
  hasReceipt(destination: string, messageId: string): Promise<boolean>;
  loadInput(event: DomainEvent): Promise<AgentCoreInput>;
  commit(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, output: AgentCoreOutput, update: StateUpdateResult, outgoing: readonly MessageEnvelope[]): Promise<"committed" | "duplicate">;
  pendingOutbox(limit: number): Promise<readonly PendingOutput[]>;
  markOutboxSent(id: string): Promise<void>;
}

export type AgentRuntimeOptions = { readonly destination: string; readonly defaultOutputDestination: string; readonly queue: MessageQueue; readonly harness: AgentHarness; readonly persistence: RuntimePersistence; readonly ids: IdGenerator; readonly now: () => Date };

export class AgentRuntime {
  readonly #updates = new StateUpdateService();
  #tail: Promise<void> = Promise.resolve();
  constructor(private readonly options: AgentRuntimeOptions) {}

  start(signal: AbortSignal): Promise<void> {
    return this.options.queue.subscribe(this.options.destination, (message) => this.#serialize(() => this.#handle(message, signal)), signal);
  }
  async drain(): Promise<void> { await this.#tail; }
  #serialize(work: () => Promise<void>): Promise<void> {
    const result = this.#tail.then(work, work);
    this.#tail = result.catch(() => undefined);
    return result;
  }
  async #handle(message: MessageEnvelope, signal: AbortSignal): Promise<void> {
    if (await this.options.persistence.hasReceipt(message.destination, message.id)) return;
    const payload = IncomingPayload.parse(message.payload);
    const event: DomainEvent = { id: this.options.ids.next(), agentId: message.destination, kind: payload.type === "user-message" ? "user-message" : "external", occurredAt: this.options.now().toISOString(), payload: payload.type === "user-message" ? { text: payload.text } : { senderAgentId: payload.senderAgentId, reportedContent: payload.content, provenance: payload.provenance }, causationId: message.id, correlationId: message.id };
    const input = await this.options.persistence.loadInput(event);
    const output = await this.options.harness.run(input, signal);
    const update = this.#updates.apply(event.agentId, input.dynamicState, output.stateUpdates);
    const outgoingDestination = message.replyTo ?? this.options.defaultOutputDestination;
    const agentReply = payload.type === "agent-message" && outgoingDestination === message.source;
    const outgoing: MessageEnvelope[] = output.action.type === "respond" ? [{ id: this.options.ids.next(), destination: outgoingDestination, source: message.destination, sentAt: this.options.now().toISOString(), availableAt: this.options.now().toISOString(), expiresAt: message.expiresAt, attempt: 0, hop: message.hop + (agentReply ? 1 : 0), payload: agentReply ? { type: "agent-message", senderAgentId: event.agentId, content: output.action.content, provenance: { causationId: message.id, runId: input.run.runId } } : { type: "agent-response", text: output.action.content, agentId: event.agentId, correlationId: message.id, ...(payload.type === "user-message" && payload.replyContext !== undefined ? { replyContext: payload.replyContext } : {}) } }] : [];
    await this.options.persistence.commit(message, event, input, output, update, outgoing);
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
