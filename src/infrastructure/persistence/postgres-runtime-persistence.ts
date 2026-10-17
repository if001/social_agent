import type { Pool, QueryResultRow } from "pg";
import { errorLogContext } from "../../observability/logger.js";

import type { PendingOutput, RuntimePersistence } from "../../application/agent-runtime.js";
import type { IdGenerator } from "../../application/ports.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import type { AgentStatePatchResult } from "../../application/agent-state-patch.js";
import { DomainError, type AgentCoreInput, type AgentRunResult, type DomainEvent, type MessageEnvelope, type ToolExecutionRecord } from "../../domain/contracts.js";
import { PostgresEventTransaction } from "./event-transaction.js";
import { PostgresUnitOfWork } from "./postgres.js";

type RuntimeInputLoader = (event: DomainEvent) => Promise<AgentCoreInput>;
type OutboxRow = QueryResultRow & { id: string; envelope: MessageEnvelope };

export class PostgresRuntimePersistence implements RuntimePersistence {
  readonly #transaction: PostgresEventTransaction;
  constructor(private readonly pool: Pool, private readonly inputLoader: RuntimeInputLoader, private readonly ids: IdGenerator, private readonly now: () => Date, _legacyMemoryEmbedding?: unknown, tools?: ToolRegistry) { this.#transaction = new PostgresEventTransaction(new PostgresUnitOfWork(pool), tools); }

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
  async commit(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, result: AgentRunResult, update: AgentStatePatchResult, outgoing: readonly MessageEnvelope[]): Promise<"committed" | "duplicate"> {
    const validatedTools = this.#validateTools(input, result.toolExecutions).map((execution) => ({ ...execution, id: this.ids.next() }));
    const actorSubject = input.observation.actor?.type === "human" || input.observation.actor?.type === "agent" ? [input.observation.actor.id] : [];
    const immediateMemories = update.remember === undefined ? [] : [{ id: this.ids.next(), agentId: event.agentId, kind: "episodic" as const, content: update.remember, occurredAt: event.occurredAt, createdAt: this.now().toISOString(), relatedSubjectIds: actorSubject, importance: "Agent Coreが次の判断へ残すと決めた経験", retrievalPriority: "normal" as const, evidenceEventIds: [event.id] }];
    const committed = await this.#transaction.commit({
      destination: message.destination, messageId: message.id,
      event: { id: event.id, agentId: event.agentId, kind: event.kind, observation: input.observation, source: message.source, occurredAt: new Date(event.occurredAt), ...(event.causationId === undefined ? {} : { causationId: event.causationId }), ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }) },
      run: { id: input.run.runId, inputStateVersion: input.currentSelf.version, startedAt: new Date(input.run.occurredAt), result: { ...result, memoryRetrievalTrace: input.memoryRetrievalTrace } },
      stateValues: { mood: update.state.mood, concerns: update.state.concerns, relationships: update.state.relationships },
      changes: update.changes.map((change) => ({ ...change, id: this.ids.next(), reason: "AgentTurn patch", evidenceIds: [change.eventId] })),
      memories: immediateMemories,
      toolExecutions: validatedTools,
      outbox: outgoing
    });
    return committed;
  }

  async recordFailure(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, error: unknown, toolExecutions: readonly ToolExecutionRecord[]): Promise<void> {
    const validatedTools = this.#validateTools(input, toolExecutions).map((execution) => ({ ...execution, id: this.ids.next() }));
    await this.#transaction.recordFailure({
      destination: message.destination, messageId: message.id,
      event: { id: event.id, agentId: event.agentId, kind: event.kind, observation: input.observation, source: message.source, occurredAt: new Date(event.occurredAt), ...(event.causationId === undefined ? {} : { causationId: event.causationId }), ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }) },
      run: { id: input.run.runId, inputStateVersion: input.currentSelf.version, startedAt: new Date(input.run.occurredAt), result: null },
      toolExecutions: validatedTools,
      failureReason: JSON.stringify(errorLogContext(error))
    });
  }

  async pendingOutbox(limit: number): Promise<readonly PendingOutput[]> {
    const result = await this.pool.query<OutboxRow>("SELECT id,envelope FROM outbox_messages WHERE status='pending' AND available_at<=now() ORDER BY created_at,id LIMIT $1", [limit]);
    return result.rows.map(({ envelope }) => ({ envelope }));
  }
  async markOutboxSent(id: string): Promise<void> { await this.pool.query("UPDATE outbox_messages SET status='sent',sent_at=now() WHERE id=$1", [id]); }

  #validateTools(input: AgentCoreInput, executions: readonly ToolExecutionRecord[]): readonly ToolExecutionRecord[] {
    const allowed = new Set(input.availableTools.map(({ name }) => name));
    for (const execution of executions) if (execution.runId !== input.run.runId || execution.eventId !== input.run.eventId || !allowed.has(execution.name)) throw new DomainError("VALIDATION", "Tool execution does not belong to this run or is not allowed");
    return executions;
  }
}
