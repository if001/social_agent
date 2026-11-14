import type { MemoryUpdateRepository, MemoryUpdateResult } from "../../application/memory-update.js";
import { MemoryWriteService, recordMemoryMutationFailure, type MemoryWriteOptions } from "./memory-write-repository.js";
import type { IdGenerator, MemoryEmbeddingPreparer, RetrievalService } from "../../application/ports.js";
import { MemoryUpdatePayloadSchema, type DomainEvent } from "../../domain/contracts.js";
import type { RuntimeDatabase } from "./runtime-database.js";

export class PostgresMemoryUpdateRepository implements MemoryUpdateRepository {
  constructor(private readonly database: RuntimeDatabase, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly retrieval?: RetrievalService, private readonly memoryEmbedding?: MemoryEmbeddingPreparer) {}
  async apply(event: DomainEvent): Promise<readonly MemoryUpdateResult[]> {
    const payload = MemoryUpdatePayloadSchema.parse(event.payload);
    const memoryEmbedding = this.memoryEmbedding;
    const embeddings = memoryEmbedding === undefined ? [] : await Promise.all(payload.intents.map(({ content }) => memoryEmbedding.prepareMemory(content)));
    const client = await this.database.native.connect();
    let failedIntent: (typeof payload.intents)[number] | undefined; let failedOptions: MemoryWriteOptions | undefined;
    try {
      await client.query("BEGIN"); const service = new MemoryWriteService(client, this.ids, this.now); const results: MemoryUpdateResult[] = [];
      for (const [intentIndex, intent] of payload.intents.entries()) {
        const candidates = payload.formation === true ? [] : this.retrieval === undefined ? undefined : (await this.retrieval.retrieve({ agentId: event.agentId, query: intent.content, scope: "conversation", limit: 5 })).map((item) => ({ id: item.id, kind: item.kind, content: item.content, importance: item.importance }));
        const sourceAgentId = payload.sourceAgentIds?.[intentIndex];
        const options: MemoryWriteOptions = { ...(payload.sourceEventId === undefined ? {} : { sourceEventId: payload.sourceEventId }), ...(payload.sourceRunId === undefined ? {} : { sourceRunId: payload.sourceRunId }), sourceKind: payload.sourceKind ?? "memory-update", sourceId: payload.sourceId ?? event.id, intentIndex, subjectIds: payload.subjectsByIntent?.[intentIndex] ?? [], ...(sourceAgentId === undefined ? {} : { sourceAgentId }), ...(candidates === undefined ? {} : { candidates }), ...(embeddings[intentIndex] === undefined ? {} : { embedding: embeddings[intentIndex] }) };
        failedIntent = intent; failedOptions = options;
        const result = await service.apply(event.agentId, intent, options); results.push({ intentIndex, result });
        failedIntent = undefined; failedOptions = undefined;
      }
      if (results.length > 0) { const reason = `新しいMemoryを既存Concernと照らして再評価する: ${payload.intents.map(({ content }) => content).join(" / ").slice(0, 800)}`; await client.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ($1,$2,'concern-due',$3,now()) ON CONFLICT (id) DO UPDATE SET reason=EXCLUDED.reason,next_due_at=LEAST(autonomous_schedules.next_due_at,EXCLUDED.next_due_at),lease_until=NULL,updated_at=now()", [`concern-due:memory:${event.agentId}`, event.agentId, reason]); }
      await client.query("COMMIT"); return results;
    } catch (error) { await client.query("ROLLBACK"); if (failedIntent !== undefined && failedOptions !== undefined) await recordMemoryMutationFailure(this.database.native, event.agentId, failedIntent, failedOptions, error, this.now()); throw error; } finally { client.release(); }
  }
}
