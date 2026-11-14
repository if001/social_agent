import type { MemoryIntent, MessageEnvelope, ToolExecutionRecord } from "../../domain/contracts.js";
import type { IdGenerator, MemoryEmbedding } from "../../application/ports.js";
import { MemoryWriteService, recordMemoryMutationFailure, type MemoryCandidate, type MemoryWriteOptions } from "./memory-write-repository.js";
import { AgentStateRepository } from "./postgres.js";
import type { PostgresUnitOfWork } from "./postgres.js";
import { and, eq } from "drizzle-orm";
import { agentRuns, autonomousSchedules, concernActivities, events, memoryWebEvidence, messageReceipts, outboxMessages, stateChanges, toolExecutions, webSnapshots } from "./schema.js";

export type CommitEventInput = {
  readonly destination: string;
  readonly messageId: string;
  readonly event: { readonly id: string; readonly agentId: string; readonly kind: string; readonly observation: unknown; readonly source: string; readonly occurredAt: Date; readonly causationId?: string; readonly correlationId?: string };
  readonly run: { readonly id: string; readonly inputStateVersion: number; readonly inputSnapshot?: unknown; readonly startedAt: Date; readonly result: unknown };
  readonly stateValues: Readonly<Record<string, unknown>>;
  readonly changes: readonly { readonly id: string; readonly target: string; readonly operation: string; readonly before: unknown; readonly after: unknown; readonly reason: string; readonly evidenceIds: readonly string[] }[];
  readonly concernActivities?: readonly { readonly id: string; readonly concernId: string; readonly kind: string; readonly eventId: string; readonly evidenceMemoryIds?: readonly string[] }[];
  readonly memoryIntents?: readonly MemoryIntent[];
  readonly memorySubjects?: readonly (readonly string[])[];
  readonly memoryCandidates?: readonly MemoryCandidate[];
  readonly memoryEmbeddings?: readonly MemoryEmbedding[];
  readonly memoryWebEvidence?: readonly { readonly memoryId: string; readonly snapshotIds: readonly string[] }[];
  readonly toolExecutions?: readonly (ToolExecutionRecord & { readonly id: string })[];
  readonly outbox: readonly MessageEnvelope[];
};

export type FailedEventInput = Omit<CommitEventInput, "stateValues" | "changes" | "memoryIntents" | "memoryWebEvidence" | "outbox"> & { readonly failureReason: string };

export class PostgresEventTransaction {
  constructor(private readonly unitOfWork: PostgresUnitOfWork, private readonly ids?: IdGenerator, private readonly now?: () => Date) {}
  async commit(input: CommitEventInput): Promise<"committed" | "duplicate"> {
    let failedIntent: MemoryIntent | undefined; let failedOptions: MemoryWriteOptions | undefined;
    try { return await this.unitOfWork.transaction(async (client) => {
      const reserved = await client.insert(messageReceipts).values({ destination: input.destination, messageId: input.messageId, status: "processing" }).onConflictDoNothing().returning({ messageId: messageReceipts.messageId });
      if (reserved.length === 0) return "duplicate";
      await client.insert(events).values({ id: input.event.id, agentId: input.event.agentId, kind: input.event.kind, observation: input.event.observation, source: input.event.source, causationId: input.event.causationId ?? null, correlationId: input.event.correlationId ?? null, status: "processing", occurredAt: input.event.occurredAt });
      await client.insert(agentRuns).values({ id: input.run.id, agentId: input.event.agentId, eventId: input.event.id, inputStateVersion: input.run.inputStateVersion, inputSnapshot: input.run.inputSnapshot ?? null, startedAt: input.run.startedAt });
      const repository = new AgentStateRepository(client);
      await repository.update(input.event.agentId, input.run.inputStateVersion, input.stateValues);
      await this.#syncConcernSchedules(client, input.event.agentId, input.stateValues.concerns);
      if (input.changes.length > 0) await client.insert(stateChanges).values(input.changes.map((change) => ({ id: change.id, runId: input.run.id, target: change.target, operation: change.operation, before: change.before, after: change.after, reason: change.reason, evidenceIds: change.evidenceIds })));
      if ((input.concernActivities?.length ?? 0) > 0) await client.insert(concernActivities).values((input.concernActivities ?? []).map((activity) => ({ id: activity.id, agentId: input.event.agentId, concernId: activity.concernId, kind: activity.kind, eventId: activity.eventId, runId: input.run.id, evidenceMemoryIds: activity.evidenceMemoryIds ?? [], occurredAt: input.event.occurredAt }))).onConflictDoNothing();
      for (const [index, intent] of (input.memoryIntents ?? []).entries()) {
        if (this.ids === undefined || this.now === undefined) throw new Error("MemoryWriteService requires ids and now");
        const options: MemoryWriteOptions = { subjectIds: input.memorySubjects?.[index] ?? [], sourceEventId: input.event.id, sourceRunId: input.run.id, sourceKind: "agent-run", sourceId: input.run.id, intentIndex: index, ...(input.memoryCandidates === undefined ? {} : { candidates: input.memoryCandidates }), ...(input.memoryEmbeddings?.[index] === undefined ? {} : { embedding: input.memoryEmbeddings[index] }) };
        failedIntent = intent; failedOptions = options;
        await new MemoryWriteService(client, this.ids, this.now).apply(input.event.agentId, intent, options);
        failedIntent = undefined; failedOptions = undefined;
      }
      for (const evidence of input.memoryWebEvidence ?? []) for (const snapshotId of evidence.snapshotIds) {
        const exists = (await client.select({ id: webSnapshots.id }).from(webSnapshots).where(eq(webSnapshots.id, snapshotId)).limit(1))[0];
        if (exists !== undefined) await client.insert(memoryWebEvidence).values({ memoryId: evidence.memoryId, snapshotId }).onConflictDoNothing();
      }
      await this.#insertToolExecutions(client, input, input.toolExecutions ?? []);
      if (input.outbox.length > 0) await client.insert(outboxMessages).values(input.outbox.map((envelope) => ({ id: envelope.id, agentId: input.event.agentId, envelope })));
      await client.update(agentRuns).set({ result: input.run.result, finishedAt: new Date() }).where(eq(agentRuns.id, input.run.id));
      await client.update(events).set({ status: "completed" }).where(eq(events.id, input.event.id));
      await client.update(messageReceipts).set({ status: "completed", processedAt: new Date() }).where(and(eq(messageReceipts.destination, input.destination), eq(messageReceipts.messageId, input.messageId)));
      return "committed";
    }); } catch (error) { if (failedIntent !== undefined && failedOptions !== undefined && this.now !== undefined) await recordMemoryMutationFailure(this.unitOfWork.native, input.event.agentId, failedIntent, failedOptions, error, this.now()); throw error; }
  }

  async recordFailure(input: FailedEventInput): Promise<void> {
    await this.unitOfWork.transaction(async (client) => {
      await client.insert(events).values({ id: input.event.id, agentId: input.event.agentId, kind: input.event.kind, observation: input.event.observation, source: input.event.source, causationId: input.event.causationId ?? null, correlationId: input.event.correlationId ?? null, status: "failed", occurredAt: input.event.occurredAt }).onConflictDoNothing();
      await client.insert(agentRuns).values({ id: input.run.id, agentId: input.event.agentId, eventId: input.event.id, inputStateVersion: input.run.inputStateVersion, inputSnapshot: input.run.inputSnapshot ?? null, result: input.run.result, failureReason: input.failureReason, startedAt: input.run.startedAt, finishedAt: new Date() }).onConflictDoUpdate({ target: agentRuns.id, set: { failureReason: input.failureReason, finishedAt: new Date() } });
      await this.#insertToolExecutions(client, input, input.toolExecutions ?? []);
    });
  }

  async #insertToolExecutions(client: Parameters<Parameters<PostgresUnitOfWork["transaction"]>[0]>[0], _input: Pick<CommitEventInput, "event" | "run">, executions: readonly (ToolExecutionRecord & { readonly id: string })[]): Promise<void> {
    for (const execution of executions) {
      await client.insert(toolExecutions).values({ id: execution.id, runId: execution.runId, toolCallId: execution.callId, tool: execution.name, input: execution.input, result: execution.result ?? null, error: execution.error ?? null, startedAt: new Date(execution.startedAt), finishedAt: new Date(execution.finishedAt) }).onConflictDoNothing();
    }
  }


  async #syncConcernSchedules(client: Parameters<Parameters<PostgresUnitOfWork["transaction"]>[0]>[0], agentId: string, rawConcerns: unknown): Promise<void> {
    if (!Array.isArray(rawConcerns)) return;
    await client.delete(autonomousSchedules).where(and(eq(autonomousSchedules.agentId, agentId), eq(autonomousSchedules.kind, "concern-due")));
    for (const value of rawConcerns) {
      if (typeof value !== "object" || value === null) continue;
      const concern = value as { id?: unknown; description?: unknown; whyItMatters?: unknown; status?: unknown; reconsiderAt?: unknown };
      if (concern.status !== "active" || typeof concern.id !== "string" || typeof concern.reconsiderAt !== "string") continue;
      const reason = typeof concern.whyItMatters === "string" ? concern.whyItMatters : typeof concern.description === "string" ? concern.description : "Concernを再検討する";
      await client.insert(autonomousSchedules).values({ id: `concern:${concern.id}`, agentId, kind: "concern-due", reason, nextDueAt: new Date(concern.reconsiderAt) });
    }
  }
}
