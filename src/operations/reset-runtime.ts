import { createHash, randomUUID } from "node:crypto";
import { lstat, rename } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Pool } from "pg";
import type { InitialSelfConfig } from "../domain/contracts.js";

const historyTables = ["post_process_jobs", "state_changes", "tool_executions", "agent_runs", "events", "candidate_evidence", "long_term_candidates", "memory_web_evidence", "memory_subjects", "memories", "web_snapshots", "web_resources", "social_contexts", "scheduled_tasks", "autonomous_schedules", "outbox_messages", "message_receipts", "runtime_correlations", "runtime_rate_windows"];

// Move runtime-owned data out of the active roots; never recursively delete a configured path.
export async function resetRuntime(pool: Pool, configs: readonly InitialSelfConfig[], roots: readonly string[], autonomyIntervalMs = 86_400_000): Promise<{ agents: string[]; archivedDirectories: string[] }> {
  const paths = [...new Set(roots.map(path => resolve(path)))];
  const cwd = resolve(process.cwd());
  const runtimeRoot = resolve(cwd, "var");
  for (const path of paths) {
    if (path === cwd || !path.startsWith(`${runtimeRoot}${sep}`) || paths.some(other => other !== path && path.startsWith(`${other}${sep}`))) throw new Error("Reset roots must be separate runtime directories inside the project var directory");
    const relativeParts = path.slice(cwd.length + 1).split(sep);
    let current = cwd;
    for (const part of relativeParts) {
      current = resolve(current, part);
      const info = await lstat(current).catch((error: unknown) => { if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined; throw error; });
      if (info?.isSymbolicLink()) throw new Error("Reset roots must not contain symbolic links");
    }
  }
  const client = await pool.connect();
  const moved: { from: string; to: string }[] = [];
  let committed = false;
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL lock_timeout = '5s'");
    await client.query("LOCK TABLE agents, agent_lock_keys IN EXCLUSIVE MODE");
    const agents = (await client.query<{ id: string }>("SELECT id FROM agents ORDER BY id")).rows;
    if (agents.length === 0) throw new Error("No agents to reset");
    for (const { id } of agents) {
      if (configs.filter(config => config.agent.id === id).length !== 1) throw new Error(`Exactly one initial Self config is required for ${id}`);
      const stored = await client.query<{ key: string }>("SELECT lock_key::text AS key FROM agent_lock_keys WHERE agent_id=$1", [id]);
      const key = stored.rows[0]?.key ?? createHash("sha256").update(id).digest().readBigInt64BE().toString();
      const lock = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_xact_lock($1::bigint) AS acquired", [key]);
      if (!lock.rows[0]?.acquired) throw new Error(`Stop the bot before resetting: ${id}`);
    }
    for (const table of historyTables) await client.query(`DELETE FROM ${table}`);
    for (const { id } of agents) {
      const config = configs.find(config => config.agent.id === id);
      if (!config) throw new Error(`Missing initial Self: ${id}`);
      const { agent, initialState } = config;
      await client.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ($1,$2,'idle','一定期間の無活動を契機に、現在のSelf、State、Memoryから行動を検討する',now()+$3*interval '1 millisecond')", [`idle:${id}`, id, autonomyIntervalMs]);
      await client.query("UPDATE agent_states SET acquired_disposition='経験から形成された傾向はまだない',values=$2,interests=$3,preferences=$4,roles=$5,raison_detre=$6,self_narrative=$7,self_continuity=$8,mood=$9,motives=$10,emotion=NULL,motive_exploration='[]',version=0,updated_at=now() WHERE agent_id=$1", [id, agent.values, JSON.stringify(agent.interests), JSON.stringify(agent.preferences), JSON.stringify(agent.roles), agent.raisonDetre ?? null, agent.selfNarrative, agent.selfContinuity, initialState.mood, JSON.stringify(initialState.motives)]);
    }
    const suffix = `.before-reset-${randomUUID()}`;
    for (const from of paths) {
      const to = from + suffix;
      try { await rename(from, to); moved.push({ from, to }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
    await client.query("COMMIT");
    committed = true;
    return { agents: agents.map(agent => agent.id), archivedDirectories: moved.map(item => item.to) };
  } catch (error) {
    if (!committed) {
      await client.query("ROLLBACK");
      for (const item of moved.reverse()) await rename(item.to, item.from);
    }
    throw error;
  } finally { client.release(); }
}
