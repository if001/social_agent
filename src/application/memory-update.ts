import type { DomainEvent, MemoryIntent } from "../domain/contracts.js";
import type { ConcernReevaluation } from "./concern-reevaluation.js";

export type MemoryUpdateInput = { readonly agentId: string; readonly eventId: string; readonly sourceEventId?: string; readonly sourceKind: "agent-run" | "experience-integration" | "memory-update" | "reflection-formation" | "reflection-reconciliation"; readonly sourceId: string; readonly sourceRunId?: string; readonly intents: readonly MemoryIntent[]; readonly subjectsByIntent?: readonly (readonly string[])[]; readonly sourceAgentIds?: readonly (string | undefined)[]; readonly formation?: boolean };
export type MemoryUpdateResult = { readonly intentIndex: number; readonly result: { readonly operation: "create" | "update" | "no-op"; readonly memoryId?: string; readonly version?: number } };

export interface MemoryUpdateSink {
  enqueue(input: MemoryUpdateInput): Promise<void>;
  enqueueAndWait?(input: MemoryUpdateInput): Promise<void>;
}
export interface MemoryUpdateRepository { apply(event: DomainEvent): Promise<readonly MemoryUpdateResult[]>; }

export class DirectMemoryUpdateSink implements MemoryUpdateSink {
  constructor(private readonly handler: MemoryUpdateHandler, private readonly now: () => Date) {}
  enqueue(input: MemoryUpdateInput): Promise<void> {
    // Keep the response and the next user-message responsive: the memory update
    // runs after the response commit and is serialized by MemoryWriteService.
    void this.enqueueAndWait(input).catch(() => undefined);
    return Promise.resolve();
  }

  async enqueueAndWait(input: MemoryUpdateInput): Promise<void> {
    await this.handler.handle({ id: input.eventId, agentId: input.agentId, kind: "internal", occurredAt: this.now().toISOString(), payload: { targetKind: "memory-update", sourceKind: input.sourceKind, sourceId: input.sourceId, ...(input.sourceEventId === undefined ? {} : { sourceEventId: input.sourceEventId }), ...(input.sourceRunId === undefined ? {} : { sourceRunId: input.sourceRunId }), intents: input.intents, ...(input.subjectsByIntent === undefined ? {} : { subjectsByIntent: input.subjectsByIntent }), ...(input.sourceAgentIds === undefined ? {} : { sourceAgentIds: input.sourceAgentIds }), ...(input.formation ? { formation: true } : {}) } });
  }
}

export class MemoryUpdateHandler {
  constructor(private readonly repository: MemoryUpdateRepository, private readonly reevaluation?: ConcernReevaluation) {}
  async handle(event: DomainEvent): Promise<readonly MemoryUpdateResult[]> {
    const results = await this.repository.apply(event);
    const payload = event.payload as Record<string, unknown>;
    const sourceKind = typeof payload.sourceKind === "string" ? payload.sourceKind : "memory-update";
    const sourceId = typeof payload.sourceId === "string" ? payload.sourceId : event.id;
    const memoryIds = results.flatMap(({ result }) => result.operation === "no-op" || result.memoryId === undefined ? [] : [result.memoryId]);
    if (this.reevaluation !== undefined && memoryIds.length > 0 && sourceKind !== "reflection-formation" && sourceKind !== "reflection-reconciliation") await this.reevaluation.consider({ agentId: event.agentId, sourceKind, sourceId, ...(typeof payload.sourceEventId === "string" ? { sourceEventId: payload.sourceEventId } : {}), ...(typeof payload.sourceRunId === "string" ? { sourceRunId: payload.sourceRunId } : {}), memoryIds }, new AbortController().signal);
    return results;
  }
}
