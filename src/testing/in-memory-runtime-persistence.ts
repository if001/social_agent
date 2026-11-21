import type { RuntimePersistence, PendingOutput } from "../application/agent-runtime.js";
import type { AgentStatePatchResult } from "../application/agent-state-patch.js";
import type { AgentCoreInput, AgentRunResult, DomainEvent, MessageEnvelope, ToolExecutionRecord } from "../domain/contracts.js";
import type { ObservationGateAudit } from "../application/observation-gate.js";

export class InMemoryRuntimePersistence implements RuntimePersistence {
  readonly receipts = new Set<string>();
  readonly #gateClaims = new Set<string>();
  readonly events: DomainEvent[] = [];
  readonly updates: AgentStatePatchResult[] = [];
  readonly failures: { readonly event: DomainEvent; readonly error: unknown; readonly toolExecutions: readonly ToolExecutionRecord[] }[] = [];
  readonly ignoredObservations: { readonly event: DomainEvent; readonly gate: ObservationGateAudit }[] = [];
  readonly correlations = new Map<string, string>();
  readonly #outbox = new Map<string, { envelope: MessageEnvelope; sent: boolean }>();
  constructor(private readonly inputFactory: (event: DomainEvent) => AgentCoreInput | Promise<AgentCoreInput>) {}
  hasReceipt(destination: string, messageId: string): Promise<boolean> { return Promise.resolve(this.receipts.has(`${destination}:${messageId}`)); }
  claimObservationGate(destination: string, messageId: string): Promise<boolean> { const key = `${destination}:${messageId}`; if (this.receipts.has(key) || this.#gateClaims.has(key)) return Promise.resolve(false); this.#gateClaims.add(key); return Promise.resolve(true); }
  releaseObservationGate(destination: string, messageId: string): Promise<void> { this.#gateClaims.delete(`${destination}:${messageId}`); return Promise.resolve(); }
  loadInput(event: DomainEvent): Promise<AgentCoreInput> { return Promise.resolve(this.inputFactory(event)); }
  activateTriggers(): Promise<void> { return Promise.resolve(); }
  authorizeInbound(event: DomainEvent, messageId: string): Promise<void> { const key = `${event.agentId}:${event.correlationId ?? event.id}`; const existing = this.correlations.get(key); if (existing !== undefined && existing !== messageId) return Promise.reject(new Error("Correlation loop detected")); this.correlations.set(key, messageId); return Promise.resolve(); }
  commit(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, result: AgentRunResult, update: AgentStatePatchResult, outgoing: readonly MessageEnvelope[], _subjectIds?: readonly string[], _gate?: ObservationGateAudit, receiptPreclaimed = false): Promise<"committed" | "duplicate"> {
    const key = `${message.destination}:${message.id}`;
    if (this.receipts.has(key) || (receiptPreclaimed && !this.#gateClaims.delete(key))) return Promise.resolve("duplicate");
    this.receipts.add(key); this.events.push(event); this.updates.push(update);
    for (const envelope of outgoing) this.#outbox.set(envelope.id, { envelope, sent: false });
    return Promise.resolve("committed");
  }
  recordIgnoredObservation(message: MessageEnvelope, event: DomainEvent, gate: ObservationGateAudit, _subjectIds?: readonly string[], receiptPreclaimed = false): Promise<"committed" | "duplicate"> {
    const key = `${message.destination}:${message.id}`;
    if (this.receipts.has(key) || (receiptPreclaimed && !this.#gateClaims.delete(key))) return Promise.resolve("duplicate");
    this.receipts.add(key); this.events.push(event); this.ignoredObservations.push({ event, gate });
    return Promise.resolve("committed");
  }
  recordFailure(_message: MessageEnvelope, event: DomainEvent, _input: AgentCoreInput, error: unknown, toolExecutions: readonly ToolExecutionRecord[], _observationGate?: ObservationGateAudit): Promise<void> { this.failures.push({ event, error, toolExecutions: [...toolExecutions] }); return Promise.resolve(); }
  pendingOutbox(limit: number): Promise<readonly PendingOutput[]> { return Promise.resolve([...this.#outbox.values()].filter(({ sent }) => !sent).slice(0, limit).map(({ envelope }) => ({ envelope }))); }
  markOutboxSent(id: string): Promise<void> { const item = this.#outbox.get(id); if (item !== undefined) item.sent = true; return Promise.resolve(); }
}
