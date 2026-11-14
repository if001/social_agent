import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryUpdateHandler } from "../../src/application/memory-update.js";
import { PostgresMemoryUpdateRepository } from "../../src/infrastructure/persistence/postgres-memory-update-repository.js";
import { createRuntimeDatabase } from "../../src/infrastructure/persistence/runtime-database.js";
import type { DomainEvent } from "../../src/domain/contracts.js";
import { createIntegrationDatabase, integrationDatabaseConfigured } from "../support/integration-database.js";

const describeDatabase = integrationDatabaseConfigured() ? describe : describe.skip;

const event = (ids: string[]): DomainEvent => ({
  id: "memory-update-event",
  agentId: "a",
  kind: "internal",
  occurredAt: "2026-10-31T00:00:00.000Z",
  payload: {
    targetKind: "memory-update",
    intents: [
      { content: "ユーザーAは技術の話を好む", reason: "次の対話で使う", evidenceEventIds: [ids[0] ?? "event-1"], confidence: "medium", target: "semantic" },
      { content: "低確度の推測", reason: "推測", evidenceEventIds: [ids[0] ?? "event-1"], confidence: "low", target: "episodic" }
    ]
  }
});

describeDatabase("memory-update Event", () => {
  let database: ReturnType<typeof createIntegrationDatabase>;
  let pool: Pool;
  let sequence = 0;
  beforeAll(async () => {
    database = createIntegrationDatabase(); pool = database.pool;
    await database.prepare();
    await pool.query("INSERT INTO agent_families(id,name,shared_disposition,base_instruction) VALUES ('family','Family','Curious','Help')");
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ('a','family','Agent A','Calm')");
    await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,concerns,relationships,mood) VALUES ('a','Careful','Growing','[]','[]','[]','Calm')");
  });
  afterAll(async () => {
    await database.close();
  });

  it("FR-58, FR-61, AC-13: applies intents without an LLM and is idempotent", async () => {
    const embedded: string[] = [];
    const handler = new MemoryUpdateHandler(new PostgresMemoryUpdateRepository(createRuntimeDatabase(pool), { next: () => `id-${String(++sequence)}` }, () => new Date("2026-10-31T00:00:00Z"), undefined, {
      prepareMemory: (content) => {
        embedded.push(content);
        return Promise.resolve({ status: "ready" as const, vector: Array.from({ length: 768 }, () => 0), model: "fake", dimension: 768 });
      }
    }));
    const first = await handler.handle(event(["event-1"]));
    expect(first.map(({ result }) => result.operation)).toEqual(["create", "no-op"]);
    const second = await handler.handle(event(["event-1"]));
    expect(second.map(({ result }) => result.operation)).toEqual(["create", "no-op"]);
    expect((await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM memories WHERE content='ユーザーAは技術の話を好む'")).rows[0]).toEqual({ count: 1 });
    expect((await pool.query<{ embedding_status: string; embedding_model: string }>("SELECT embedding_status,embedding_model FROM memories WHERE content='ユーザーAは技術の話を好む'")).rows[0]).toEqual({ embedding_status: "ready", embedding_model: "fake" });
    expect((await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM memory_mutations WHERE source_event_id='memory-update-event'")).rows[0]?.count).toBe(2);
    const schedule = (await pool.query<{ id: string; kind: string; reason: string }>("SELECT id,kind,reason FROM autonomous_schedules WHERE id='concern-due:memory:a'")).rows[0];
    expect(schedule?.id).toBe("concern-due:memory:a");
    expect(schedule?.kind).toBe("concern-due");
    expect(schedule?.reason).toContain("新しいMemory");
    expect(embedded).toEqual(["ユーザーAは技術の話を好む", "低確度の推測", "ユーザーAは技術の話を好む", "低確度の推測"]);
  });
});
