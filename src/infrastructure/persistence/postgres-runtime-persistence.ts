import type { Pool, QueryResultRow } from "pg";
import { errorLogContext } from "../../observability/logger.js";

import type { PendingOutput, RuntimeExecutionInput, RuntimePersistence } from "../../application/agent-runtime.js";
import type { IdGenerator } from "../../application/ports.js";
import type { AgentStatePatchResult } from "../../application/agent-state-patch.js";
import { DomainError, type AgentCoreInput, type AgentRunResult, type DomainEvent, type MessageEnvelope, type ToolExecutionRecord } from "../../domain/contracts.js";
import { PostgresEventTransaction } from "./event-transaction.js";
import { PostgresUnitOfWork } from "./postgres.js";

type RuntimeInputLoader = (event: DomainEvent) => Promise<AgentCoreInput | RuntimeExecutionInput>;
type OutboxRow = QueryResultRow & { id: string; envelope: MessageEnvelope };

/** The canonical pre-execution Agent Core input used by audit and Integration. */
function decisionInputSnapshot(input: AgentCoreInput): AgentCoreInput { return input; }

export class PostgresRuntimePersistence implements RuntimePersistence {
  readonly #transaction: PostgresEventTransaction;
  constructor(private readonly pool: Pool, private readonly inputLoader: RuntimeInputLoader, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly agentId?: string) { this.#transaction = new PostgresEventTransaction(new PostgresUnitOfWork(pool), ids, now); }

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
    const focusedConcerns = validatedTools.flatMap((execution) => {
      if (!execution.ok || (execution.name !== "concern_get" && execution.name !== "concern_history") || !("concernId" in execution.input) || typeof execution.input.concernId !== "string") return [];
      return [{ concernId: execution.input.concernId, kind: "focused" as const, eventId: event.id }];
    });
    // A generic successful Tool call is not necessarily about the selected
    // Concern. concern_history is the narrow read seam that carries both the
    // Concern ID and the evidence it retrieved, so only it proves progress.
    const progressedConcerns = validatedTools.flatMap((execution) => {
      if (!execution.ok || execution.name !== "concern_history" || !("concernId" in execution.input) || typeof execution.input.concernId !== "string") return [];
      return [{ concernId: execution.input.concernId, kind: "progressed" as const, eventId: event.id }];
    });
    const committed = await this.#transaction.commit({
      destination: message.destination, messageId: message.id,
      event: { id: event.id, agentId: event.agentId, kind: event.kind, observation: input.observation, source: message.source, occurredAt: new Date(event.occurredAt), ...(event.causationId === undefined ? {} : { causationId: event.causationId }), ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }) },
      run: { id: input.run.runId, inputStateVersion: input.currentSelf.version, inputSnapshot: decisionInputSnapshot(input), startedAt: new Date(input.run.occurredAt), result: { ...result, memoryRetrievalTrace: input.memoryRetrievalTrace } },
      stateValues: { mood: update.state.mood, concerns: update.state.concerns, relationships: update.state.relationships },
      changes: update.changes.map((change) => ({ ...change, id: this.ids.next(), reason: "AgentTurn patch", evidenceIds: [change.eventId] })),
      concernActivities: [...update.concernActivities, ...focusedConcerns, ...progressedConcerns].map((activity, index) => ({ ...activity, id: `runtime:${input.run.runId}:${String(index)}:${activity.kind}:${activity.concernId}` })),
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
      run: { id: input.run.runId, inputStateVersion: input.currentSelf.version, inputSnapshot: decisionInputSnapshot(input), startedAt: new Date(input.run.occurredAt), result: null },
      toolExecutions: validatedTools,
      failureReason: JSON.stringify(errorLogContext(error))
    });
  }

  async pendingOutbox(limit: number): Promise<readonly PendingOutput[]> {
    const result = await this.pool.query<OutboxRow>("SELECT id,envelope FROM outbox_messages WHERE status='pending' AND available_at<=now() AND ($2::text IS NULL OR agent_id=$2) ORDER BY created_at,id LIMIT $1", [limit, this.agentId ?? null]);
    return result.rows.map(({ envelope }) => ({ envelope }));
  }
  async markOutboxSent(id: string): Promise<void> { await this.pool.query("UPDATE outbox_messages SET status='sent',sent_at=now() WHERE id=$1", [id]); }

  #validateTools(input: AgentCoreInput, executions: readonly ToolExecutionRecord[]): readonly ToolExecutionRecord[] {
    const allowed = new Set(input.availableTools.map(({ name }) => name));
    for (const execution of executions) if (execution.runId !== input.run.runId || execution.eventId !== input.run.eventId || !allowed.has(execution.name)) throw new DomainError("VALIDATION", "Tool execution does not belong to this run or is not allowed");
    return executions;
  }
}
