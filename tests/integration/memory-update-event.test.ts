import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parse } from "dotenv";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryUpdateHandler } from "../../src/application/memory-update.js";
import type { DomainEvent } from "../../src/domain/contracts.js";
import { migrate } from "../../src/infrastructure/persistence/postgres.js";

const sample = parse(await readFile(new URL("../../.env.sample", import.meta.url)));
const databaseUrl = (process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL ?? sample.POSTGRES_URL)?.replace("postgresql+psycopg://", "postgresql://");
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

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
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const control = new Pool({ connectionString: databaseUrl, max: 2 });
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public,ext`, max: 4 });
  let sequence = 0;
  beforeAll(async () => {
    await control.query(`CREATE SCHEMA ${schema}`);
    await migrate(pool);
    await pool.query("INSERT INTO agent_families(id,name,shared_disposition,base_instruction) VALUES ('family','Family','Curious','Help')");
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ('a','family','Agent A','Calm')");
    await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,concerns,relationships,mood) VALUES ('a','Careful','Growing','[]','[]','[]','Calm')");
  });
  afterAll(async () => {
    await pool.end();
    await control.query(`DROP SCHEMA ${schema} CASCADE`);
    await control.end();
  });

  it("FR-58, FR-61, AC-13: applies intents without an LLM and is idempotent", async () => {
    const handler = new MemoryUpdateHandler(pool, { next: () => `id-${String(++sequence)}` }, () => new Date("2026-10-31T00:00:00Z"));
    const first = await handler.handle(event(["event-1"]));
    expect(first.map(({ result }) => result.operation)).toEqual(["create", "no-op"]);
    const second = await handler.handle(event(["event-1"]));
    expect(second.map(({ result }) => result.operation)).toEqual(["create", "no-op"]);
    expect((await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM memories WHERE content='ユーザーAは技術の話を好む'")).rows[0]).toEqual({ count: 1 });
    expect((await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM memory_mutations WHERE source_event_id='memory-update-event'")).rows[0]?.count).toBe(2);
  });
});
