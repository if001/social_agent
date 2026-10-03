import type { RuntimePersistence, PendingOutput } from "../application/agent-runtime.js";
import type { StateUpdateResult } from "../application/state-update-service.js";
import type { AgentCoreInput, AgentRunResult, DomainEvent, MessageEnvelope, ToolExecutionRecord } from "../domain/contracts.js";

export class InMemoryRuntimePersistence implements RuntimePersistence {
  readonly receipts = new Set<string>();
  readonly events: DomainEvent[] = [];
  readonly updates: StateUpdateResult[] = [];
  readonly failures: { readonly event: DomainEvent; readonly error: unknown; readonly toolExecutions: readonly ToolExecutionRecord[] }[] = [];
  readonly #outbox = new Map<string, { envelope: MessageEnvelope; sent: boolean }>();
  constructor(private readonly inputFactory: (event: DomainEvent) => AgentCoreInput | Promise<AgentCoreInput>) {}
  hasReceipt(destination: string, messageId: string): Promise<boolean> { return Promise.resolve(this.receipts.has(`${destination}:${messageId}`)); }
  loadInput(event: DomainEvent): Promise<AgentCoreInput> { return Promise.resolve(this.inputFactory(event)); }
  activateTriggers(): Promise<void> { return Promise.resolve(); }
  commit(message: MessageEnvelope, event: DomainEvent, _input: AgentCoreInput, _result: AgentRunResult, update: StateUpdateResult, outgoing: readonly MessageEnvelope[]): Promise<"committed" | "duplicate"> {
    const key = `${message.destination}:${message.id}`;
    if (this.receipts.has(key)) return Promise.resolve("duplicate");
    this.receipts.add(key); this.events.push(event); this.updates.push(update);
    for (const envelope of outgoing) this.#outbox.set(envelope.id, { envelope, sent: false });
    return Promise.resolve("committed");
  }
  recordFailure(_message: MessageEnvelope, event: DomainEvent, _input: AgentCoreInput, error: unknown, toolExecutions: readonly ToolExecutionRecord[]): Promise<void> { this.failures.push({ event, error, toolExecutions: [...toolExecutions] }); return Promise.resolve(); }
  pendingOutbox(limit: number): Promise<readonly PendingOutput[]> { return Promise.resolve([...this.#outbox.values()].filter(({ sent }) => !sent).slice(0, limit).map(({ envelope }) => ({ envelope }))); }
  markOutboxSent(id: string): Promise<void> { const item = this.#outbox.get(id); if (item !== undefined) item.sent = true; return Promise.resolve(); }
}
