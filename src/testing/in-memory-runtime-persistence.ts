import type { RuntimePersistence, PendingOutput, PendingPostProcess, PostProcessOutput } from "../application/agent-runtime.js";
import type { StateUpdateResult } from "../application/state-update-service.js";
import type { AgentCoreInput, AgentRunResult, DomainEvent, MessageEnvelope, ToolExecutionRecord } from "../domain/contracts.js";

export class InMemoryRuntimePersistence implements RuntimePersistence {
  readonly receipts = new Set<string>();
  readonly events: DomainEvent[] = [];
  readonly updates: StateUpdateResult[] = [];
  readonly failures: { readonly event: DomainEvent; readonly error: unknown; readonly toolExecutions: readonly ToolExecutionRecord[] }[] = [];
  readonly correlations = new Map<string, string>();
  readonly postProcessOutputs: { readonly type: PendingPostProcess["type"]; readonly output: PostProcessOutput }[] = [];
  readonly postProcessFailures: unknown[] = [];
  readonly #postProcessJobs: PendingPostProcess[] = [];
  readonly #outbox = new Map<string, { envelope: MessageEnvelope; sent: boolean }>();
  constructor(private readonly inputFactory: (event: DomainEvent) => AgentCoreInput | Promise<AgentCoreInput>) {}
  hasReceipt(destination: string, messageId: string): Promise<boolean> { return Promise.resolve(this.receipts.has(`${destination}:${messageId}`)); }
  loadInput(event: DomainEvent): Promise<AgentCoreInput> { return Promise.resolve(this.inputFactory(event)); }
  activateTriggers(): Promise<void> { return Promise.resolve(); }
  authorizeInbound(event: DomainEvent, messageId: string): Promise<void> { const key = `${event.agentId}:${event.correlationId ?? event.id}`; const existing = this.correlations.get(key); if (existing !== undefined && existing !== messageId) return Promise.reject(new Error("Correlation loop detected")); this.correlations.set(key, messageId); return Promise.resolve(); }
  commit(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, result: AgentRunResult, update: StateUpdateResult, outgoing: readonly MessageEnvelope[]): Promise<"committed" | "duplicate"> {
    const key = `${message.destination}:${message.id}`;
    if (this.receipts.has(key)) return Promise.resolve("duplicate");
    this.receipts.add(key); this.events.push(event); this.updates.push(update);
    const snapshot = { run: { runId: input.run.runId, eventId: input.run.eventId, agentId: input.run.agentId, occurredAt: input.run.occurredAt }, observation: input.observation, recentExperiences: input.recentExperiences, ...(input.persona === undefined ? {} : { persona: input.persona }), self: input.self, dynamicState: input.dynamicState, socialContext: input.socialContext, memories: input.memories, interaction: { interpretation: result.output.interpretation, action: result.output.action, toolResults: [] } };
    this.#postProcessJobs.push({ id: `experience-integration:${input.run.runId}`, type: "experience-integration", agentId: event.agentId, inputStateVersion: input.self.version + 1, input: snapshot, attempt: 0 });
    for (const envelope of outgoing) this.#outbox.set(envelope.id, { envelope, sent: false });
    return Promise.resolve("committed");
  }
  recordFailure(_message: MessageEnvelope, event: DomainEvent, _input: AgentCoreInput, error: unknown, toolExecutions: readonly ToolExecutionRecord[]): Promise<void> { this.failures.push({ event, error, toolExecutions: [...toolExecutions] }); return Promise.resolve(); }
  pendingOutbox(limit: number): Promise<readonly PendingOutput[]> { return Promise.resolve([...this.#outbox.values()].filter(({ sent }) => !sent).slice(0, limit).map(({ envelope }) => ({ envelope }))); }
  markOutboxSent(id: string): Promise<void> { const item = this.#outbox.get(id); if (item !== undefined) item.sent = true; return Promise.resolve(); }
  claimPostProcess(agentId?: string, runId?: string, type?: PendingPostProcess["type"]): Promise<PendingPostProcess | undefined> { const index = this.#postProcessJobs.findIndex((job) => (agentId === undefined || job.agentId === agentId) && (runId === undefined || job.input.run.runId === runId) && (type === undefined || job.type === type)); if (index < 0) return Promise.resolve(undefined); const [job] = this.#postProcessJobs.splice(index, 1); return Promise.resolve(job === undefined ? undefined : { ...job, attempt: job.attempt + 1 }); }
  completePostProcess(job: PendingPostProcess, output: PostProcessOutput): Promise<void> { this.postProcessOutputs.push({ type: job.type, output }); return Promise.resolve(); }
  failPostProcess(job: PendingPostProcess, error: unknown): Promise<void> { this.postProcessFailures.push(error); if (job.attempt < 2) this.#postProcessJobs.push(job); return Promise.resolve(); }
}
