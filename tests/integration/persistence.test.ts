import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { parse } from "dotenv";
import { Pool } from "pg";

import { AgentStateRepository, PostgresUnitOfWork, migrate, withAgentLock } from "../../src/infrastructure/persistence/postgres.js";
import { PostgresEventTransaction } from "../../src/infrastructure/persistence/event-transaction.js";
import { messageFixture } from "../../src/testing/contract-fixtures.js";
import { PostgresMemoryRetriever } from "../../src/infrastructure/persistence/postgres-memory-retriever.js";
import { PostgresScheduleRepository } from "../../src/infrastructure/persistence/postgres-schedule-repository.js";

const sample = parse(await readFile(new URL("../../.env.sample", import.meta.url)));
const databaseUrl = process.env.TEST_POSTGRES_URL ?? sample.POSTGRES_URL?.replace("postgresql+psycopg://", "postgresql://");
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase("PostgreSQL persistence", () => {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const control = new Pool({ connectionString: databaseUrl, max: 2 });
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public,ext`, max: 4 });

  beforeAll(async () => {
    await control.query(`CREATE SCHEMA ${schema}`);
    await migrate(pool);
    await migrate(pool);
    await pool.query("INSERT INTO agent_families(id,name,shared_disposition,capabilities,base_instruction) VALUES ('family','Family','Curious','[]','Help')");
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ('a','family','Agent A','Calm'),('b','family','Agent B','Bold')");
    for (const agentId of ["a", "b"]) await pool.query("INSERT INTO agent_states(agent_id,acquired_disposition,values,role,self_narrative,self_continuity,emotion,mood,drive,desire) VALUES ($1,'Learning','Care','Helper','Growing','Continuous','Interested','Calm','Learn','Help')", [agentId]);
  });
  afterAll(async () => {
    await pool.end();
    await control.query(`DROP SCHEMA ${schema} CASCADE`);
    await control.end();
  });

  it("round-trips isolated agent state and rejects stale versions", async () => {
    const repository = new AgentStateRepository(pool);
    expect((await repository.find<{ agent_id: string }>("a"))?.agent_id).toBe("a");
    expect(await repository.find("missing")).toBeUndefined();
    await expect(repository.update("a", 0, { mood: "Focused" })).resolves.toBe(1);
    await expect(repository.update("a", 0, { mood: "Stale" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repository.find<{ mood: string }>("b"))?.mood).toBe("Calm");
  });

  it("rolls back event and outbox as one unit", async () => {
    const unit = new PostgresUnitOfWork(pool);
    await expect(unit.transaction(async (client) => {
      await client.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('event-rollback','a','internal','{}','test','processing',now())");
      await client.query("INSERT INTO outbox_messages(id,agent_id,envelope) VALUES ('outbox-rollback','a','{}')");
      throw new Error("stop");
    })).rejects.toThrow("stop");
    expect((await pool.query("SELECT id FROM events WHERE id='event-rollback'")).rowCount).toBe(0);
    expect((await pool.query("SELECT id FROM outbox_messages WHERE id='outbox-rollback'")).rowCount).toBe(0);
  });

  it("serializes an agent advisory lock and releases it", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = withAgentLock(pool, 4242, () => held);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await expect(withAgentLock(pool, 4242, () => Promise.resolve(undefined))).rejects.toMatchObject({ code: "CONFLICT" });
    release(); await first;
    await expect(withAgentLock(pool, 4242, () => Promise.resolve("ok"))).resolves.toBe("ok");
  });

  it("commits receipt, event, state trace and outbox atomically and deduplicates", async () => {
    const transaction = new PostgresEventTransaction(new PostgresUnitOfWork(pool));
    const input = {
      destination: "agent:a", messageId: "incoming-1",
      event: { id: "event-1", agentId: "a", kind: "user-message", observation: { summary: "hello" }, source: "terminal", occurredAt: new Date() },
      run: { id: "run-1", inputStateVersion: 1, startedAt: new Date(), result: { action: "respond" } },
      stateValues: { mood: "Attentive" },
      changes: [{ id: "change-1", target: "mood", operation: "set" as const, before: "Focused", after: "Attentive", reason: "Greeting", evidenceIds: ["event-1"] }],
      outbox: [messageFixture({ id: "outbox-1", destination: "terminal" })]
    };
    await expect(transaction.commit(input)).resolves.toBe("committed");
    await expect(transaction.commit(input)).resolves.toBe("duplicate");
    expect((await pool.query<{ status: string }>("SELECT status FROM message_receipts WHERE message_id='incoming-1'")).rows[0]?.status).toBe("completed");
    expect((await pool.query<{ reason: string }>("SELECT reason FROM state_changes WHERE id='change-1'")).rows[0]?.reason).toBe("Greeting");
    expect((await pool.query("SELECT id FROM outbox_messages WHERE id='outbox-1'")).rowCount).toBe(1);
  });

  it("leaves no partial records after a version conflict", async () => {
    const transaction = new PostgresEventTransaction(new PostgresUnitOfWork(pool));
    await expect(transaction.commit({
      destination: "agent:a", messageId: "incoming-conflict",
      event: { id: "event-conflict", agentId: "a", kind: "internal", observation: {}, source: "test", occurredAt: new Date() },
      run: { id: "run-conflict", inputStateVersion: 0, startedAt: new Date(), result: {} }, stateValues: { mood: "Wrong" }, changes: [], outbox: []
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await pool.query("SELECT 1 FROM message_receipts WHERE message_id='incoming-conflict'")).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM events WHERE id='event-conflict'")).rowCount).toBe(0);
  });

  it("combines lexical and vector retrieval with filters and agent isolation", async () => {
    const unit = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const opposite = Array.from({ length: 768 }, (_, index) => index === 1 ? 1 : 0);
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,embedding,embedding_model) VALUES ('memory-a1','a','semantic','typescript architecture','Relevant','2026-01-02',$1::vector,'test'),('memory-a2','a','episodic','unrelated note','Relevant','2026-01-01',$2::vector,'test'),('memory-b1','b','semantic','typescript secret','Relevant','2026-01-03',$1::vector,'test')", [`[${unit.join(",")}]`, `[${opposite.join(",")}]`]);
    const retriever = new PostgresMemoryRetriever(pool);
    const found = await retriever.retrieve("a", "typescript", unit, 5, { kinds: ["semantic"] });
    expect(found.map(({ id }) => id)).toEqual(["memory-a1"]);
    expect(found.every(({ agentId }) => agentId === "a")).toBe(true);
  });

  it("claims each due intention once across scheduler instances", async () => {
    await pool.query("INSERT INTO intentions(id,agent_id,description,reason,status,next_review_at) VALUES ('due-1','a','Review goal','Due','active','2026-01-01')");
    const first = new PostgresScheduleRepository(pool); const second = new PostgresScheduleRepository(pool);
    const claims = await Promise.all([first.claimDue(new Date("2026-01-02T00:00:00Z"), 10), second.claimDue(new Date("2026-01-02T00:00:00Z"), 10)]);
    expect(claims.flat().map(({ id }) => id)).toEqual(["due-1"]);
    await first.complete("due-1", null); expect((await first.claimDue(new Date("2026-01-03T00:00:00Z"), 10))).toEqual([]);
  });
});
