import { createHash } from "node:crypto";
import type { Pool, PoolClient } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryWriteService, recordMemoryMutationFailure } from "../../src/infrastructure/persistence/memory-write-repository.js";
import type { MemoryIntent } from "../../src/domain/contracts.js";
import { createIntegrationDatabase, integrationDatabaseConfigured } from "../support/integration-database.js";

const describeDatabase = integrationDatabaseConfigured() ? describe : describe.skip;

const intent = (overrides: Partial<MemoryIntent> = {}): MemoryIntent => ({ content: "ユーザーAは技術の話を好む", reason: "次の対話で再利用する", evidenceEventIds: ["event-1"], confidence: "medium", target: "semantic", perspective: "user", purpose: "user-context", ...overrides });

describeDatabase("MemoryWriteService", () => {
  let database: ReturnType<typeof createIntegrationDatabase>;
  let pool: Pool;
  let sequence = 0;
  const ids = { next: () => `id-${String(++sequence)}` };
  const service = async (work: (client: PoolClient, writer: MemoryWriteService) => Promise<void>) => {
    const client = await pool.connect();
    try { await client.query("BEGIN"); await work(client, new MemoryWriteService(client, ids, () => new Date("2026-10-31T00:00:00Z"))); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  };
  beforeAll(async () => {
    database = createIntegrationDatabase(); pool = database.pool;
    await database.prepare();
    await pool.query("INSERT INTO agent_families(id,name,shared_disposition,base_instruction) VALUES ('family','Family','Curious','Help')");
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ('a','family','Agent A','Calm'),('b','family','Agent B','Bold')");
    await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,relationships,mood) VALUES ('a','Careful','Growing','[]','[]','Calm'),('b','Bold','Growing','[]','[]','Calm')");
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,retrieval_priority,occurred_at,created_at,evidence_event_ids,version,embedding_status) VALUES ('existing','a','semantic','ユーザーAは技術の話を好む','重要','normal',now(),now(),'[]',0,'pending'),('other','b','semantic','ユーザーBは静かな話を好む','重要','normal',now(),now(),'[]',0,'pending')");
  });
  afterAll(async () => {
    await database.close();
  });

  it("FR-57, NFR-15, AC-12: creates, updates and records mutations", async () => {
    await service(async (_client, writer) => { await expect(writer.apply("a", intent(), { sourceEventId: "event-1", sourceRunId: "run-1", sourceKind: "experience-integration", sourceId: "integration-1", intentIndex: 0, candidates: [{ id: "existing", kind: "semantic", content: "ユーザーAは技術の話を好む", importance: "重要" }] })).resolves.toMatchObject({ operation: "update", memoryId: "existing", version: 1 }); });
    expect((await pool.query<{ content: string; version: number; perspective: string; purpose: string }>("SELECT content,version,perspective,purpose FROM memories WHERE id='existing'")).rows[0]).toEqual({ content: "ユーザーAは技術の話を好む", version: 1, perspective: "user", purpose: "user-context" });
    await service(async (_client, writer) => { await expect(writer.apply("a", intent({ content: "ユーザーAは静かな環境を好む", target: "semantic" }))).resolves.toMatchObject({ operation: "create", version: 0 }); });
    expect((await pool.query("SELECT operation FROM memory_mutations WHERE agent_id='a' ORDER BY created_at")).rows.map((row: { operation: string }) => row.operation)).toEqual(["update", "create"]);
    expect((await pool.query<{ source_kind: string; source_id: string; source_run_id: string; before: { content: string; version: number }; after: { content: string; version: number }; reason: string; evidence_event_ids: string[]; status: string; idempotency_key: string; applied_at: Date }>("SELECT source_kind,source_id,source_run_id,before,after,reason,evidence_event_ids,status,idempotency_key,applied_at FROM memory_mutations WHERE source_id='integration-1'")).rows[0]).toMatchObject({ source_kind: "experience-integration", source_id: "integration-1", source_run_id: "run-1", before: { content: "ユーザーAは技術の話を好む", version: 0 }, after: { content: "ユーザーAは技術の話を好む", version: 1 }, reason: "次の対話で再利用する", evidence_event_ids: ["event-1"], status: "applied", idempotency_key: "a:experience-integration:integration-1:0", applied_at: new Date("2026-10-31T00:00:00Z") });
    expect((await pool.query<{ version: number }>("SELECT version FROM memories WHERE id='other'")).rows[0]?.version).toBe(0);
  });

  it("FR-56, FR-57, AC-12: does not create a low-confidence unmatched intent and records no-op", async () => {
    await service(async (_client, writer) => { await expect(writer.apply("a", intent({ content: "低確度の推測", confidence: "low" }))).resolves.toEqual({ operation: "no-op" }); });
    expect((await pool.query("SELECT id FROM memories WHERE content='低確度の推測'")).rowCount).toBe(0);
    expect((await pool.query("SELECT operation FROM memory_mutations WHERE agent_id='a' ORDER BY created_at DESC LIMIT 1")).rows[0]).toEqual({ operation: "no-op" });
  });

  it("NFR-15, AC-12: is idempotent for the same sourceEventId and intentIndex", async () => {
    const idempotent = intent({ content: "冪等性を確認するMemory", target: "semantic" });
    await service(async (_client, writer) => { await expect(writer.apply("a", idempotent, { sourceEventId: "idem-event", intentIndex: 0 })).resolves.toMatchObject({ operation: "create" }); });
    await service(async (_client, writer) => { await expect(writer.apply("a", idempotent, { sourceEventId: "idem-event", intentIndex: 0 })).resolves.toMatchObject({ operation: "create" }); });
    expect((await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM memories WHERE content='冪等性を確認するMemory'")).rows[0]).toEqual({ count: 1 });
    expect((await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM memory_mutations WHERE source_event_id='idem-event'")).rows[0]).toEqual({ count: 1 });
  });

  it("NFR-15: does not reapply a successful reconciliation retry", async () => {
    const options = { sourceKind: "reflection-reconciliation" as const, sourceId: "reflection-retry", intentIndex: 0 };
    const change = { memoryId: "existing", operation: "update" as const, content: "訂正後の技術嗜好", reason: "後続Eventで確認した", evidenceEventIds: ["later-event"] };
    await service(async (_client, writer) => { await writer.reconcile("a", change, options); });
    const once = (await pool.query<{ version: number }>("SELECT version FROM memories WHERE id='existing'")).rows[0]?.version;
    await service(async (_client, writer) => { await writer.reconcile("a", change, options); });
    expect((await pool.query<{ version: number }>("SELECT version FROM memories WHERE id='existing'")).rows[0]?.version).toBe(once);
    expect((await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM memory_mutations WHERE source_kind='reflection-reconciliation' AND source_id='reflection-retry' AND intent_index=0")).rows[0]?.count).toBe(1);
  });

  it("NFR-17: preserves a failed attempt without blocking a later successful retry", async () => {
    const failedIntent = intent({ content: "失敗後に再試行するMemory" });
    const options = { sourceKind: "memory-update" as const, sourceId: "retry-after-failure", intentIndex: 0 };
    await Promise.all([
      recordMemoryMutationFailure(pool, "a", failedIntent, options, new Error("temporary failure 1"), new Date("2026-10-31T00:00:00Z")),
      recordMemoryMutationFailure(pool, "a", failedIntent, options, new Error("temporary failure 2"), new Date("2026-10-31T00:00:01Z"))
    ]);
    await service(async (_client, writer) => { await expect(writer.apply("a", failedIntent, options)).resolves.toMatchObject({ operation: "create" }); });
    expect((await pool.query<{ operation: string; status: string; attempt: number }>("SELECT operation,status,attempt FROM memory_mutations WHERE source_id='retry-after-failure' ORDER BY attempt")).rows).toEqual([{ operation: "unknown", status: "failed", attempt: 1 }, { operation: "unknown", status: "failed", attempt: 2 }, { operation: "create", status: "applied", attempt: 3 }]);
  });

  it("NFR-17: serializes failure audit and a concurrent successful retry with the same attempt lock", async () => {
    const concurrentIntent = intent({ content: "並行再試行するMemory" });
    const options = { sourceKind: "memory-update" as const, sourceId: "concurrent-failure-success", intentIndex: 0 };
    await Promise.all([
      recordMemoryMutationFailure(pool, "a", concurrentIntent, options, new Error("concurrent failure"), new Date("2026-10-31T00:00:00Z")),
      service(async (_client, writer) => { await writer.apply("a", concurrentIntent, options); })
    ]);
    const rows = (await pool.query<{ status: string; attempt: number }>("SELECT status,attempt FROM memory_mutations WHERE source_id='concurrent-failure-success' ORDER BY attempt")).rows;
    expect(rows.map(({ attempt }) => attempt)).toEqual([1, 2]);
    expect(new Set(rows.map(({ status }) => status))).toEqual(new Set(["failed", "applied"]));
  });

  it("stores an Agent experience as self-guidance without a user subject", async () => {
    let memoryId: string | undefined;
    await service(async (_client, writer) => { memoryId = (await writer.apply("a", intent({ content: "公式ページの404が続いたため検索語を変える", reason: "次の探索方法を選び直す", target: "episodic", perspective: "self", purpose: "self-guidance" }))).memoryId; });
    if (memoryId === undefined) throw new Error("self-guidance memory was not created");
    expect((await pool.query<{ perspective: string; purpose: string }>("SELECT perspective,purpose FROM memories WHERE id=$1", [memoryId])).rows[0]).toEqual({ perspective: "self", purpose: "self-guidance" });
    expect((await pool.query("SELECT subject_id FROM memory_subjects WHERE memory_id=$1", [memoryId])).rowCount).toBe(0);
  });

  it("NFR-15, AC-12: does not deadlock with the bot-host process lock", async () => {
    const holder = await pool.connect();
    const lockKey = createHash("sha256").update("a").digest().readBigInt64BE().toString();
    try {
      await holder.query("INSERT INTO agent_lock_keys(agent_id,lock_key) VALUES ('a',$1) ON CONFLICT (agent_id) DO NOTHING", [lockKey]);
      const acquired = await holder.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS acquired", [lockKey]);
      expect(acquired.rows[0]?.acquired).toBe(true);
      await expect(Promise.race([
        service(async (_client, writer) => { await writer.apply("a", intent({ content: "プロセスロックと共存するMemory", target: "semantic" })); }),
        new Promise((_, reject) => setTimeout(() => { reject(new Error("MemoryWriteService deadlocked")); }, 2_000))
      ])).resolves.toBeUndefined();
    } finally {
      await holder.query("SELECT pg_advisory_unlock_all()");
      holder.release();
    }
  });
});
