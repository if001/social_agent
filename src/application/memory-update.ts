import type { Pool } from "pg";

import type { IdGenerator, RetrievalService } from "./ports.js";
import { MemoryWriteService, type MemoryWriteResult } from "./memory-write-service.js";
import { MemoryUpdatePayloadSchema, type DomainEvent, type MemoryIntent } from "../domain/contracts.js";

export type MemoryUpdateInput = { readonly agentId: string; readonly sourceEventId: string; readonly intents: readonly MemoryIntent[]; readonly subjectsByIntent?: readonly (readonly string[])[]; readonly sourceAgentIds?: readonly (string | undefined)[] };
export type MemoryUpdateResult = { readonly intentIndex: number; readonly result: MemoryWriteResult };

export interface MemoryUpdateSink {
  enqueue(input: MemoryUpdateInput): Promise<void>;
  enqueueAndWait?(input: MemoryUpdateInput): Promise<void>;
}

export class DirectMemoryUpdateSink implements MemoryUpdateSink {
  constructor(private readonly handler: MemoryUpdateHandler, private readonly now: () => Date) {}
  enqueue(input: MemoryUpdateInput): Promise<void> {
    // Keep the response and the next user-message responsive: the memory update
    // runs after the response commit and is serialized by MemoryWriteService.
    void this.enqueueAndWait(input).catch(() => undefined);
    return Promise.resolve();
  }

  async enqueueAndWait(input: MemoryUpdateInput): Promise<void> {
    await this.handler.handle({ id: input.sourceEventId, agentId: input.agentId, kind: "internal", occurredAt: this.now().toISOString(), payload: { targetKind: "memory-update", intents: input.intents, ...(input.subjectsByIntent === undefined ? {} : { subjectsByIntent: input.subjectsByIntent }), ...(input.sourceAgentIds === undefined ? {} : { sourceAgentIds: input.sourceAgentIds }) } });
  }
}

export class MemoryUpdateHandler {
  constructor(
    private readonly pool: Pool,
    private readonly ids: IdGenerator,
    private readonly now: () => Date,
    private readonly retrieval?: RetrievalService
  ) {}

  async handle(event: DomainEvent): Promise<readonly MemoryUpdateResult[]> {
    const payload = MemoryUpdatePayloadSchema.parse(event.payload);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const service = new MemoryWriteService(client, this.ids, this.now);
      const results: MemoryUpdateResult[] = [];
      for (const [intentIndex, intent] of payload.intents.entries()) {
        const candidates = this.retrieval === undefined ? undefined : (await this.retrieval.retrieve({ agentId: event.agentId, query: intent.content, scope: "conversation", limit: 5 })).map((item) => ({ id: item.id, kind: item.kind, content: item.content, importance: item.importance }));
        const subjectIds = payload.subjectsByIntent?.[intentIndex] ?? [];
        const sourceAgentId = payload.sourceAgentIds?.[intentIndex];
        const result = await service.apply(event.agentId, intent, { sourceEventId: event.id, intentIndex, subjectIds, ...(sourceAgentId === undefined ? {} : { sourceAgentId }), ...(candidates === undefined ? {} : { candidates }) });
        results.push({ intentIndex, result });
      }
      await client.query("COMMIT");
      return results;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
