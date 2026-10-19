import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { loadInitialSelfFile } from "../../src/config/initial-self.js";
import { migrate } from "../../src/infrastructure/persistence/postgres.js";
import { initializeAgent } from "../../src/operations/operations.js";
import { resetRuntime } from "../../src/operations/reset-runtime.js";

it("NFR-11: resets isolated data, preserves bot config, and refuses a running bot", async () => {
  const url = process.env.POSTGRES_URL?.replace("postgresql+psycopg://", "postgresql://");
  if (!url) throw new Error("POSTGRES_URL is required");
  const schema = `test_reset_${randomUUID().replaceAll("-", "")}`;
  const control = new Pool({ connectionString: url });
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema},public,ext` });
  await mkdir("var", { recursive: true });
  const root = await mkdtemp(resolve("var/reset-test-"));
  let archived: string[] = [];
  const config = await loadInitialSelfFile("config/initial-self/ao.yaml");
  const lock = await pool.connect();
  try {
    await control.query(`CREATE SCHEMA ${schema}`);
    await migrate(pool);
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
    expect((await pool.query<{ count: string }>("SELECT count(*) FROM autonomous_schedules")).rows[0]?.count).toBe("2");
    expect((await pool.query<{ count: string }>("SELECT count(*) FROM reflection_runs")).rows[0]?.count).toBe("0");
    await expect(access(root)).rejects.toThrow();
  } finally {
    await lock.query("SELECT pg_advisory_unlock_all()"); lock.release();
    await pool.end(); await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await control.end();
    await Promise.all([root, ...archived].map(path => rm(path, { recursive: true, force: true })));
  }
});
