import type { MemoryIntent, MessageEnvelope, ToolExecutionRecord } from "../../domain/contracts.js";
import type { IdGenerator, MemoryEmbedding } from "../../application/ports.js";
import { MemoryWriteService, recordMemoryMutationFailure, type MemoryCandidate, type MemoryWriteOptions } from "./memory-write-repository.js";
import { AgentStateRepository } from "./postgres.js";
import type { PostgresUnitOfWork } from "./postgres.js";
import { and, eq, isNull } from "drizzle-orm";
import { agentRuns, concernActivities, conversationMessages, conversations, events, eventSubjects, memoryWebEvidence, messageReceipts, observationGateDecisions, outboxMessages, stateChanges, toolExecutions, webSnapshots } from "./schema.js";

export type CommitEventInput = {
  readonly destination: string;
  readonly messageId: string;
  readonly event: { readonly id: string; readonly agentId: string; readonly kind: string; readonly observation: unknown; readonly source: string; readonly occurredAt: Date; readonly causationId?: string; readonly correlationId?: string };
  readonly eventSubjectIds?: readonly string[];
  readonly receiptPreclaimed?: boolean;
  readonly observationGate?: { readonly decision: "ignore" | "engage"; readonly reason: string; readonly conversationGoal?: string; readonly input?: unknown; readonly modelCalls: number; readonly retrievalCount: number; readonly failureReason?: string };
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
  readonly conversation?: { readonly id: string; readonly correlationId: string; readonly goal: string; readonly status: "active" | "completed"; readonly endedReason?: string; readonly externalMessageId?: string };
};

export type FailedEventInput = Omit<CommitEventInput, "stateValues" | "changes" | "memoryIntents" | "memoryWebEvidence" | "outbox"> & { readonly failureReason: string };

export class PostgresEventTransaction {
  constructor(private readonly unitOfWork: PostgresUnitOfWork, private readonly ids?: IdGenerator, private readonly now?: () => Date) {}
  async commit(input: CommitEventInput): Promise<"committed" | "duplicate"> {
    let failedIntent: MemoryIntent | undefined; let failedOptions: MemoryWriteOptions | undefined;
    try { return await this.unitOfWork.transaction(async (client) => {
      const reserved = input.receiptPreclaimed
        ? await client.update(messageReceipts).set({ status: "processing" }).where(and(eq(messageReceipts.destination, input.destination), eq(messageReceipts.messageId, input.messageId), eq(messageReceipts.status, "gate-processing"))).returning({ messageId: messageReceipts.messageId })
        : await client.insert(messageReceipts).values({ destination: input.destination, messageId: input.messageId, status: "processing" }).onConflictDoNothing().returning({ messageId: messageReceipts.messageId });
      if (reserved.length === 0) return "duplicate";
      await client.insert(events).values({ id: input.event.id, agentId: input.event.agentId, kind: input.event.kind, observation: input.event.observation, source: input.event.source, causationId: input.event.causationId ?? null, correlationId: input.event.correlationId ?? null, status: "processing", occurredAt: input.event.occurredAt });
      const eventSubjectIds = input.eventSubjectIds ?? [];
      if (eventSubjectIds.length > 0) await client.insert(eventSubjects).values(eventSubjectIds.map((subjectId) => ({ eventId: input.event.id, subjectId }))).onConflictDoNothing();
      if (input.observationGate !== undefined) await client.insert(observationGateDecisions).values({ eventId: input.event.id, ...input.observationGate }).onConflictDoNothing();
      await client.insert(agentRuns).values({ id: input.run.id, agentId: input.event.agentId, eventId: input.event.id, inputStateVersion: input.run.inputStateVersion, inputSnapshot: input.run.inputSnapshot ?? null, startedAt: input.run.startedAt });
      if (input.conversation !== undefined) {
        const completedAt = input.conversation.status === "completed" ? new Date() : null;
        await client.insert(conversations).values({ id: input.conversation.id, agentId: input.event.agentId, goal: input.conversation.goal, status: input.conversation.status, startedEventId: input.event.id, lastEventId: input.event.id, endedReason: input.conversation.endedReason ?? null, completedAt })
          .onConflictDoUpdate({ target: conversations.id, set: { status: input.conversation.status, lastEventId: input.event.id, endedReason: input.conversation.endedReason ?? null, completedAt, updatedAt: new Date() } });
        await client.update(conversationMessages).set({ conversationId: input.conversation.id }).where(and(eq(conversationMessages.agentId, input.event.agentId), eq(conversationMessages.correlationId, input.conversation.correlationId), isNull(conversationMessages.conversationId)));
        if (input.conversation.externalMessageId !== undefined) await client.insert(conversationMessages).values({ agentId: input.event.agentId, externalMessageId: input.conversation.externalMessageId, conversationId: input.conversation.id, correlationId: input.conversation.correlationId, direction: "inbound", eventId: input.event.id }).onConflictDoNothing();
      }
      const repository = new AgentStateRepository(client);
      await repository.update(input.event.agentId, input.run.inputStateVersion, input.stateValues);
      if (input.changes.length > 0) await client.insert(stateChanges).values(input.changes.map((change) => ({ id: change.id, runId: input.run.id, target: change.target, operation: change.operation, before: change.before, after: change.after, reason: change.reason, evidenceIds: change.evidenceIds })));
      if ((input.concernActivities?.length ?? 0) > 0) await client.insert(concernActivities).values((input.concernActivities ?? []).map((activity) => ({ id: activity.id, concernId: activity.concernId, kind: activity.kind, eventId: activity.eventId, runId: input.run.id, evidenceMemoryIds: activity.evidenceMemoryIds ?? [], occurredAt: input.event.occurredAt }))).onConflictDoNothing();
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

  async claimObservationGate(destination: string, messageId: string): Promise<boolean> {
    return this.unitOfWork.transaction(async (client) => (await client.insert(messageReceipts).values({ destination, messageId, status: "gate-processing" }).onConflictDoNothing().returning({ messageId: messageReceipts.messageId })).length === 1);
  }

  async releaseObservationGate(destination: string, messageId: string): Promise<void> {
    await this.unitOfWork.transaction(async (client) => {
      await client.delete(messageReceipts).where(and(eq(messageReceipts.destination, destination), eq(messageReceipts.messageId, messageId), eq(messageReceipts.status, "gate-processing")));
    });
  }

  async recordIgnoredObservation(input: { readonly destination: string; readonly messageId: string; readonly event: CommitEventInput["event"]; readonly eventSubjectIds?: readonly string[]; readonly gate: NonNullable<CommitEventInput["observationGate"]>; readonly receiptPreclaimed?: boolean }): Promise<"committed" | "duplicate"> {
    return this.unitOfWork.transaction(async (client) => {
      const reserved = input.receiptPreclaimed
        ? await client.update(messageReceipts).set({ status: "processing" }).where(and(eq(messageReceipts.destination, input.destination), eq(messageReceipts.messageId, input.messageId), eq(messageReceipts.status, "gate-processing"))).returning({ messageId: messageReceipts.messageId })
        : await client.insert(messageReceipts).values({ destination: input.destination, messageId: input.messageId, status: "processing" }).onConflictDoNothing().returning({ messageId: messageReceipts.messageId });
      if (reserved.length === 0) return "duplicate";
      await client.insert(events).values({ id: input.event.id, agentId: input.event.agentId, kind: input.event.kind, observation: input.event.observation, source: input.event.source, causationId: input.event.causationId ?? null, correlationId: input.event.correlationId ?? null, status: "completed", occurredAt: input.event.occurredAt });
      const subjects = input.eventSubjectIds ?? [];
      if (subjects.length > 0) await client.insert(eventSubjects).values(subjects.map((subjectId) => ({ eventId: input.event.id, subjectId }))).onConflictDoNothing();
      await client.insert(observationGateDecisions).values({ eventId: input.event.id, ...input.gate });
      await client.update(messageReceipts).set({ status: "completed", processedAt: new Date() }).where(and(eq(messageReceipts.destination, input.destination), eq(messageReceipts.messageId, input.messageId)));
      return "committed";
    });
  }

  async recordFailure(input: FailedEventInput): Promise<void> {
    await this.unitOfWork.transaction(async (client) => {
      await client.insert(events).values({ id: input.event.id, agentId: input.event.agentId, kind: input.event.kind, observation: input.event.observation, source: input.event.source, causationId: input.event.causationId ?? null, correlationId: input.event.correlationId ?? null, status: "failed", occurredAt: input.event.occurredAt }).onConflictDoNothing();
      if (input.observationGate !== undefined) await client.insert(observationGateDecisions).values({ eventId: input.event.id, ...input.observationGate }).onConflictDoNothing();
      await client.insert(agentRuns).values({ id: input.run.id, agentId: input.event.agentId, eventId: input.event.id, inputStateVersion: input.run.inputStateVersion, inputSnapshot: input.run.inputSnapshot ?? null, result: input.run.result, failureReason: input.failureReason, startedAt: input.run.startedAt, finishedAt: new Date() }).onConflictDoUpdate({ target: agentRuns.id, set: { failureReason: input.failureReason, finishedAt: new Date() } });
      await this.#insertToolExecutions(client, input, input.toolExecutions ?? []);
    });
  }

  async #insertToolExecutions(client: Parameters<Parameters<PostgresUnitOfWork["transaction"]>[0]>[0], _input: Pick<CommitEventInput, "event" | "run">, executions: readonly (ToolExecutionRecord & { readonly id: string })[]): Promise<void> {
    for (const execution of executions) {
      await client.insert(toolExecutions).values({ id: execution.id, runId: execution.runId, toolCallId: execution.callId, tool: execution.name, input: execution.input, result: execution.result ?? null, error: execution.error ?? null, startedAt: new Date(execution.startedAt), finishedAt: new Date(execution.finishedAt) }).onConflictDoNothing();
    }
  }
}
