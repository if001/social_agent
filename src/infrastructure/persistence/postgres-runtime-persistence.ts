import type { Pool, QueryResultRow } from "pg";

import type { PendingOutput, RuntimePersistence } from "../../application/agent-runtime.js";
import type { IdGenerator } from "../../application/ports.js";
import type { StateUpdateResult } from "../../application/state-update-service.js";
import { canTransitionIntention, DomainError, IntentionTriggerSchema, type AgentCoreInput, type AgentRunResult, type Candidate, type DomainEvent, type Intention, type Memory, type MessageEnvelope, type ToolExecutionRecord } from "../../domain/contracts.js";
import { PostgresEventTransaction } from "./event-transaction.js";
import type { MemoryEmbeddingLifecycle } from "./postgres-memory-embedding.js";
import { PostgresUnitOfWork } from "./postgres.js";

type RuntimeInputLoader = (event: DomainEvent) => Promise<AgentCoreInput>;
type OutboxRow = QueryResultRow & { id: string; envelope: MessageEnvelope };

export class PostgresRuntimePersistence implements RuntimePersistence {
  readonly #transaction: PostgresEventTransaction;
  constructor(private readonly pool: Pool, private readonly inputLoader: RuntimeInputLoader, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly memoryEmbedding?: MemoryEmbeddingLifecycle) { this.#transaction = new PostgresEventTransaction(new PostgresUnitOfWork(pool)); }

  async hasReceipt(destination: string, messageId: string): Promise<boolean> { return (await this.pool.query("SELECT 1 FROM message_receipts WHERE destination=$1 AND message_id=$2 AND status='completed'", [destination, messageId])).rowCount === 1; }
  loadInput(event: DomainEvent): Promise<AgentCoreInput> { return this.inputLoader(event); }
  async authorizeInbound(event: DomainEvent, messageId: string, maxEventsPerMinute: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const correlation = event.correlationId ?? event.id;
      const claimed = await client.query<{ message_id: string }>("INSERT INTO runtime_correlations(agent_id,correlation_id,message_id) VALUES ($1,$2,$3) ON CONFLICT (agent_id,correlation_id) DO UPDATE SET message_id=runtime_correlations.message_id RETURNING message_id", [event.agentId, correlation, messageId]);
      if (claimed.rows[0]?.message_id !== messageId) throw new DomainError("VALIDATION", "Correlation loop detected");
      const rate = await client.query<{ event_count: number }>("INSERT INTO runtime_rate_windows(agent_id,window_start,event_count) VALUES ($1,date_trunc('minute',now()),1) ON CONFLICT (agent_id,window_start) DO UPDATE SET event_count=runtime_rate_windows.event_count+1 RETURNING event_count", [event.agentId]);
      if ((rate.rows[0]?.event_count ?? 0) > maxEventsPerMinute) throw new DomainError("VALIDATION", "Agent event rate limit exceeded");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async activateTriggers(event: DomainEvent): Promise<void> {
    if (event.payload.schedulerGenerated === true) return;
    const result = await this.pool.query<{ id: string; trigger: unknown }>("SELECT id,trigger FROM intentions WHERE agent_id=$1 AND status='active' AND trigger IS NOT NULL", [event.agentId]);
    const payload = JSON.stringify(event.payload).toLocaleLowerCase("ja");
    for (const row of result.rows) {
      const parsed = IntentionTriggerSchema.safeParse(row.trigger); if (!parsed.success) continue;
      const trigger = parsed.data; let due: Date | undefined;
      if (trigger.kind === "idle") due = new Date(new Date(event.occurredAt).getTime() + trigger.idleForMs);
      if (trigger.kind === "event" && trigger.eventKinds.includes(event.kind) && (trigger.keywords.length === 0 || trigger.keywords.some((keyword) => payload.includes(keyword.toLocaleLowerCase("ja"))))) due = new Date(event.occurredAt);
      if (trigger.kind === "manual-review" && (event.kind === "system" || event.kind === "internal") && event.payload.manualReviewIntentionId === row.id) due = new Date(event.occurredAt);
      if (due !== undefined) await this.pool.query("UPDATE intentions SET next_review_at=$2,updated_at=now() WHERE id=$1", [row.id, due]);
    }
  }

  async commit(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, result: AgentRunResult, update: StateUpdateResult, outgoing: readonly MessageEnvelope[]): Promise<"committed" | "duplicate"> {
    const materialized = await this.#materialize(event, input, result);
    const committed = await this.#transaction.commit({
      destination: message.destination, messageId: message.id,
      event: { id: event.id, agentId: event.agentId, kind: event.kind, observation: input.observation, source: message.source, occurredAt: new Date(event.occurredAt), ...(event.causationId === undefined ? {} : { causationId: event.causationId }), ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }) },
      run: { id: input.run.runId, inputStateVersion: input.self.version, startedAt: new Date(input.run.occurredAt), result: { ...result, memoryRetrievalTrace: input.memoryRetrievalTrace } },
      stateValues: { mood: update.state.mood, drives: update.state.drives, current_interests: update.state.currentInterests },
      changes: update.changes.map((change) => ({ ...change, id: this.ids.next() })),
      ...materialized,
      outbox: outgoing
    });
    if (committed === "committed" && materialized.memories.length > 0) await this.memoryEmbedding?.embedMemoryIds(event.agentId, materialized.memories.map(({ id }) => id));
    return committed;
  }

  async recordFailure(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, error: unknown, toolExecutions: readonly ToolExecutionRecord[]): Promise<void> {
    const validatedTools = this.#validateTools(input, toolExecutions).map((execution) => ({ ...execution, id: this.ids.next() }));
    await this.#transaction.recordFailure({
      destination: message.destination, messageId: message.id,
      event: { id: event.id, agentId: event.agentId, kind: event.kind, observation: input.observation, source: message.source, occurredAt: new Date(event.occurredAt), ...(event.causationId === undefined ? {} : { causationId: event.causationId }), ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }) },
      run: { id: input.run.runId, inputStateVersion: input.self.version, startedAt: new Date(input.run.occurredAt), result: null },
      toolExecutions: validatedTools,
      failureReason: error instanceof Error ? error.message : "Agent run failed"
    });
  }

  async pendingOutbox(limit: number): Promise<readonly PendingOutput[]> {
    const result = await this.pool.query<OutboxRow>("SELECT id,envelope FROM outbox_messages WHERE status='pending' AND available_at<=now() ORDER BY created_at,id LIMIT $1", [limit]);
    return result.rows.map(({ envelope }) => ({ envelope }));
  }
  async markOutboxSent(id: string): Promise<void> { await this.pool.query("UPDATE outbox_messages SET status='sent',sent_at=now() WHERE id=$1", [id]); }

  async #materialize(event: DomainEvent, input: AgentCoreInput, result: AgentRunResult): Promise<{ readonly memories: readonly Memory[]; readonly memoryWebEvidence: readonly { readonly memoryId: string; readonly snapshotIds: readonly string[] }[]; readonly intentionCreates: readonly Intention[]; readonly intentionUpdates: readonly Intention[]; readonly candidates: readonly Candidate[]; readonly toolExecutions: readonly (ToolExecutionRecord & { readonly id: string })[] }> {
    const occurredAt = event.occurredAt;
    const uniqueMemoryProposals = [...new Map(result.output.internalChanges.memoryProposals.map((proposal) => [`${proposal.kind}\u0000${proposal.content.trim()}\u0000${proposal.sourceAgentId ?? ""}`, proposal])).values()];
    const referencedSnapshotIds = [...new Set(uniqueMemoryProposals.flatMap(({ webSnapshotIds }) => webSnapshotIds ?? []))];
    const toolResultStrings = new Set<string>(); const collectStrings = (value: unknown): void => { if (typeof value === "string") toolResultStrings.add(value); else if (Array.isArray(value)) for (const item of value) collectStrings(item); else if (typeof value === "object" && value !== null) for (const item of Object.values(value)) collectStrings(item); };
    for (const execution of result.toolExecutions.filter(({ ok }) => ok)) collectStrings(execution.result);
    if (referencedSnapshotIds.some((id) => !toolResultStrings.has(id))) throw new DomainError("VALIDATION", "Memory references a Web Snapshot not observed in this run");
    if (referencedSnapshotIds.length > 0) {
      const owned = await this.pool.query<{ id: string }>("SELECT id FROM web_snapshots WHERE agent_id=$1 AND id=ANY($2::text[])", [event.agentId, referencedSnapshotIds]);
      if (owned.rows.length !== referencedSnapshotIds.length) throw new DomainError("VALIDATION", "Memory references a Web Snapshot owned by another Agent or missing");
    }
    const memories: Memory[] = []; const memoryWebEvidence: { memoryId: string; snapshotIds: readonly string[] }[] = [];
    for (const proposal of uniqueMemoryProposals) { const { webSnapshotIds = [], ...memoryProposal } = proposal; const memory: Memory = { id: this.ids.next(), agentId: event.agentId, createdAt: occurredAt, ...memoryProposal, evidenceEventIds: [...new Set([...proposal.evidenceEventIds, event.id])] }; memories.push(memory); if (webSnapshotIds.length > 0) memoryWebEvidence.push({ memoryId: memory.id, snapshotIds: webSnapshotIds }); }
    const intentionsById = new Map(input.intentions.map((intention) => [intention.id, intention]));
    const intentionCreates: Intention[] = []; const intentionUpdates: Intention[] = [];
    for (const proposal of result.output.internalChanges.intentionProposals) {
      if (proposal.operation === "create") intentionCreates.push({ id: this.ids.next(), agentId: event.agentId, description: proposal.description, status: "active", reason: proposal.reason, createdAt: occurredAt, updatedAt: occurredAt, ...(proposal.trigger === undefined ? {} : { trigger: proposal.trigger }), ...(proposal.nextReviewAt === undefined ? {} : { nextReviewAt: proposal.nextReviewAt }) });
      else {
        const current = intentionsById.get(proposal.intentionId); if (current === undefined) throw new DomainError("VALIDATION", `Unknown intention: ${proposal.intentionId}`);
        const status = proposal.status ?? current.status;
        if (status !== current.status && !canTransitionIntention(current.status, status)) throw new DomainError("VALIDATION", `Invalid intention transition: ${current.status} -> ${status}`);
        intentionUpdates.push({ ...current, description: proposal.description ?? current.description, status, reason: proposal.reason, updatedAt: occurredAt, ...(proposal.nextReviewAt === null ? { nextReviewAt: undefined } : proposal.nextReviewAt === undefined ? {} : { nextReviewAt: proposal.nextReviewAt }), ...(proposal.supersededByIntentionId === undefined ? {} : { supersededById: proposal.supersededByIntentionId }) });
      }
    }
    const memoryIds = new Set(input.memories.map(({ id }) => id));
    const uniqueCandidateProposals = [...new Map(result.output.internalChanges.longTermCandidates.map((proposal) => [`${proposal.target}\u0000${proposal.proposal.trim()}`, proposal])).values()];
    const candidates = uniqueCandidateProposals.map((proposal): Candidate => {
      if (proposal.evidenceMemoryIds.some((id) => !memoryIds.has(id))) throw new DomainError("VALIDATION", "Candidate evidence is absent from input context");
      const evidenceEventIds = [...new Set([...proposal.evidenceEventIds, event.id])];
      return { id: this.ids.next(), agentId: event.agentId, ...proposal, evidenceEventIds, status: "pending", createdAt: occurredAt };
    });
    return { memories, memoryWebEvidence, intentionCreates, intentionUpdates, candidates, toolExecutions: this.#validateTools(input, result.toolExecutions).map((execution) => ({ ...execution, id: this.ids.next() })) };
  }

  #validateTools(input: AgentCoreInput, executions: readonly ToolExecutionRecord[]): readonly ToolExecutionRecord[] {
    const allowed = new Set(input.availableTools.map(({ name }) => name));
    for (const execution of executions) if (execution.runId !== input.run.runId || execution.eventId !== input.run.eventId || !allowed.has(execution.name)) throw new DomainError("VALIDATION", "Tool execution does not belong to this run or is not allowed");
    return executions;
  }
}
