import type { DomainEvent, MemoryIntent } from "../domain/contracts.js";

export type MemoryUpdateInput = { readonly agentId: string; readonly sourceEventId: string; readonly intents: readonly MemoryIntent[]; readonly subjectsByIntent?: readonly (readonly string[])[]; readonly sourceAgentIds?: readonly (string | undefined)[]; readonly formation?: boolean };
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
    await this.handler.handle({ id: input.sourceEventId, agentId: input.agentId, kind: "internal", occurredAt: this.now().toISOString(), payload: { targetKind: "memory-update", intents: input.intents, ...(input.subjectsByIntent === undefined ? {} : { subjectsByIntent: input.subjectsByIntent }), ...(input.sourceAgentIds === undefined ? {} : { sourceAgentIds: input.sourceAgentIds }), ...(input.formation ? { formation: true } : {}) } });
  }
}

export class MemoryUpdateHandler {
  constructor(private readonly repository: MemoryUpdateRepository) {}
  handle(event: DomainEvent): Promise<readonly MemoryUpdateResult[]> { return this.repository.apply(event); }
}
