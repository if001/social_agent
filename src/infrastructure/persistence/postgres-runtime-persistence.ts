import { and, asc, eq, lte, lt, sql } from "drizzle-orm";
import { errorLogContext } from "../../observability/logger.js";

import type { PendingOutput, RuntimeExecutionInput, RuntimePersistence } from "../../application/agent-runtime.js";
import type { IdGenerator } from "../../application/ports.js";
import type { AgentStatePatchResult } from "../../application/agent-state-patch.js";
import { DomainError, type AgentCoreInput, type AgentRunResult, type DomainEvent, type MessageEnvelope, type ToolExecutionRecord } from "../../domain/contracts.js";
import { PostgresEventTransaction } from "./event-transaction.js";
import { PostgresUnitOfWork } from "./postgres.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { messageReceipts, outboxMessages, runtimeCorrelations, runtimeRateWindows } from "./schema.js";

type RuntimeInputLoader = (event: DomainEvent) => Promise<AgentCoreInput | RuntimeExecutionInput>;
/** The canonical pre-execution Agent Core input used by audit and Integration. */
function decisionInputSnapshot(input: AgentCoreInput): AgentCoreInput { return input; }

export class PostgresRuntimePersistence implements RuntimePersistence {
  readonly #transaction: PostgresEventTransaction;
  constructor(private readonly database: RuntimeDatabase, private readonly inputLoader: RuntimeInputLoader, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly agentId?: string, private readonly correlationTtlMs = 7 * 86_400_000, private readonly rateWindowRetentionMs = 3_600_000) { this.#transaction = new PostgresEventTransaction(new PostgresUnitOfWork(database.native), ids, now); }

  async hasReceipt(destination: string, messageId: string): Promise<boolean> {
    return (await this.database.db.select({ messageId: messageReceipts.messageId }).from(messageReceipts).where(and(
      eq(messageReceipts.destination, destination),
      eq(messageReceipts.messageId, messageId),
      eq(messageReceipts.status, "completed")
    )).limit(1)).length === 1;
  }
  loadInput(event: DomainEvent): Promise<AgentCoreInput> { return this.inputLoader(event); }
  async authorizeInbound(event: DomainEvent, messageId: string, maxEventsPerMinute: number): Promise<void> {
    await this.database.transaction(async (tx) => {
      await tx.delete(runtimeCorrelations).where(lt(runtimeCorrelations.createdAt, new Date(Date.now() - this.correlationTtlMs)));
      await tx.delete(runtimeRateWindows).where(lt(runtimeRateWindows.windowStart, new Date(Date.now() - this.rateWindowRetentionMs)));
      const correlation = event.correlationId ?? event.id;
      const claimed = await tx.insert(runtimeCorrelations).values({
        agentId: event.agentId, correlationId: correlation, messageId
      }).onConflictDoUpdate({
        target: [runtimeCorrelations.agentId, runtimeCorrelations.correlationId],
        set: { messageId: sql`${runtimeCorrelations.messageId}` }
      }).returning({ messageId: runtimeCorrelations.messageId });
      if (claimed[0]?.messageId !== messageId) throw new DomainError("VALIDATION", "Correlation loop detected");
      // PostgreSQL-native: incrementing a rate window must be one atomic upsert.
      const rate = await tx.execute(sql<{ event_count: number }>`INSERT INTO app.runtime_rate_windows(agent_id,window_start,event_count)
        VALUES (${event.agentId},date_trunc('minute',now()),1)
        ON CONFLICT (agent_id,window_start) DO UPDATE SET event_count=app.runtime_rate_windows.event_count+1
        RETURNING event_count`);
      if (Number(rate.rows[0]?.event_count ?? 0) > maxEventsPerMinute) throw new DomainError("VALIDATION", "Agent event rate limit exceeded");
    });
  }
  async cleanupRuntimeState(correlationBefore: Date, rateWindowBefore: Date): Promise<{ readonly correlations: number; readonly rateWindows: number }> {
    return this.database.transaction(async (tx) => {
      const correlations = await tx.delete(runtimeCorrelations).where(lt(runtimeCorrelations.createdAt, correlationBefore)).returning({ id: runtimeCorrelations.correlationId });
      const rateWindows = await tx.delete(runtimeRateWindows).where(lt(runtimeRateWindows.windowStart, rateWindowBefore)).returning({ at: runtimeRateWindows.windowStart });
      return { correlations: correlations.length, rateWindows: rateWindows.length };
    });
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
    const owner = this.agentId === undefined ? undefined : eq(outboxMessages.agentId, this.agentId);
    const rows = await this.database.db.select({ envelope: outboxMessages.envelope }).from(outboxMessages).where(and(
      eq(outboxMessages.status, "pending"),
      lte(outboxMessages.availableAt, sql`now()`),
      owner
    )).orderBy(asc(outboxMessages.createdAt), asc(outboxMessages.id)).limit(limit);
    return rows.map(({ envelope }) => ({ envelope: envelope as MessageEnvelope }));
  }
  async markOutboxSent(id: string): Promise<void> {
    await this.database.db.update(outboxMessages).set({ status: "sent", sentAt: new Date() }).where(eq(outboxMessages.id, id));
  }

  #validateTools(input: AgentCoreInput, executions: readonly ToolExecutionRecord[]): readonly ToolExecutionRecord[] {
    const allowed = new Set(input.availableTools.map(({ name }) => name));
    for (const execution of executions) if (execution.runId !== input.run.runId || execution.eventId !== input.run.eventId || !allowed.has(execution.name)) throw new DomainError("VALIDATION", "Tool execution does not belong to this run or is not allowed");
    return executions;
  }
}
