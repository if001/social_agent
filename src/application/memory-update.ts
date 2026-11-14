import type { DomainEvent, MemoryIntent } from "../domain/contracts.js";

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
  constructor(private readonly repository: MemoryUpdateRepository) {}
  handle(event: DomainEvent): Promise<readonly MemoryUpdateResult[]> { return this.repository.apply(event); }
}
