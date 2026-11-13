import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import { resolve } from "node:path";
import type { PoolClient } from "pg";
import { describe, expect, it } from "vitest";
import { loadInitialSelfFile } from "../../src/config/initial-self.js";
import { initializeAgent } from "../../src/operations/operations.js";
import { resetRuntime } from "../../src/operations/reset-runtime.js";
import { createIntegrationDatabase, integrationDatabaseConfigured } from "../support/integration-database.js";

const describeDatabase = integrationDatabaseConfigured() ? describe : describe.skip;

describeDatabase("reset runtime", () => {
  it("NFR-11: resets isolated data, preserves bot config, and refuses a running bot", async () => {
  const database = createIntegrationDatabase();
  const { pool } = database;
  await mkdir("var", { recursive: true });
  const root = await mkdtemp(resolve("var/reset-test-"));
  let archived: string[] = [];
  const config = await loadInitialSelfFile("config/initial-self/ao.yaml");
  let lock: PoolClient | undefined;
  try {
    await database.prepare();
    lock = await pool.connect();
    if (lock === undefined) throw new Error("Test lock was not acquired");
    await initializeAgent(pool, config);
    await pool.query("INSERT INTO reflection_runs(id,agent_id,input_state_version,status,input,output,completed_at) VALUES ('old-reflection',$1,0,'completed','{}','{}',now())", [config.agent.id]);
    await pool.query("UPDATE agents SET config='{\"persona\":\"keep\"}'");
    await pool.query("UPDATE agent_states SET mood='changed',version=99");
    await pool.query("INSERT INTO agent_lock_keys(agent_id,lock_key) VALUES ($1,765432109)", [config.agent.id]);
    await writeFile(`${root}/message.json`, "test");
    await lock.query("SELECT pg_advisory_lock(765432109::bigint)");
    await expect(resetRuntime(pool, [config], [root])).rejects.toThrow("Stop the bot");
    expect((await pool.query<{ version: number }>("SELECT version FROM agent_states")).rows[0]?.version).toBe(99);
    await access(`${root}/message.json`);
    await lock.query("SELECT pg_advisory_unlock_all()");
    const result = await resetRuntime(pool, [config], [root]);
    archived = result.archivedDirectories;
    expect((await pool.query("SELECT version,mood FROM agent_states")).rows[0]).toEqual({ version: 0, mood: config.initialState.mood });
    expect((await pool.query<{ config: unknown }>("SELECT config FROM agents")).rows[0]?.config).toEqual({ persona: "keep" });
    expect((await pool.query<{ count: string }>("SELECT count(*) FROM autonomous_schedules")).rows[0]?.count).toBe("3");
    expect((await pool.query<{ count: string }>("SELECT count(*) FROM reflection_runs")).rows[0]?.count).toBe("0");
    await expect(access(root)).rejects.toThrow();
  } finally {
    if (lock !== undefined) { await lock.query("SELECT pg_advisory_unlock_all()"); lock.release(); }
    await database.close();
    await Promise.all([root, ...archived].map(path => rm(path, { recursive: true, force: true })));
  }
  });
});
