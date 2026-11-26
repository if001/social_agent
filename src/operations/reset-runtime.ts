import { createHash, randomUUID } from "node:crypto";
import { lstat, rename } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Pool } from "pg";
import { initialSelfFromConfig, type InitialSelfConfig } from "../domain/contracts.js";
import type { SchedulerTimings } from "../config/config.js";
import { asc, eq, sql } from "drizzle-orm";
import { createRuntimeDatabase } from "../infrastructure/persistence/runtime-database.js";
import { advisoryLocks, agentRuns, agents, agentStates, autonomousSchedules, concernActivities, concerns, events, memories, memoryMutations, memorySubjects, memoryWebEvidence, messageReceipts, outboxMessages, reflectionAttempts, reflectionMemoryBatches, reflectionRuns, runtimeCorrelations, runtimeRateWindows, scheduledTasks, stateChanges, toolExecutions, webResources, webSnapshots } from "../infrastructure/persistence/schema.js";
import { ConcernRepository } from "../infrastructure/persistence/concern-repository.js";

// Move runtime-owned data out of the active roots; never recursively delete a configured path.
type ResetTimings = Pick<SchedulerTimings, "autonomyReviewIntervalMs" | "stateReviewIntervalMs"> & Partial<Pick<SchedulerTimings, "concernFormationIntervalMs">>;

export async function resetRuntime(pool: Pool, configs: readonly InitialSelfConfig[], roots: readonly string[], timings: ResetTimings = { autonomyReviewIntervalMs: 86_400_000, concernFormationIntervalMs: 86_400_000, stateReviewIntervalMs: 86_400_000 }): Promise<{ agents: string[]; archivedDirectories: string[] }> {
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
  const moved: { from: string; to: string }[] = [];
  let committed = false;
  try {
    const database = createRuntimeDatabase(pool);
    const agentIds = await database.transaction(async (tx) => {
      // PostgreSQL-native: reset must serialize against process advisory locks.
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql.raw("LOCK TABLE app.agents, app.agent_lock_keys IN EXCLUSIVE MODE"));
      const storedAgents = await tx.select({ id: agents.id }).from(agents).orderBy(asc(agents.id));
      if (storedAgents.length === 0) throw new Error("No agents to reset");
      for (const { id } of storedAgents) {
        if (configs.filter(config => config.agent.id === id).length !== 1) throw new Error(`Exactly one initial Self config is required for ${id}`);
        const stored = await tx.select({ key: advisoryLocks.lockKey }).from(advisoryLocks).where(eq(advisoryLocks.agentId, id)).limit(1);
        const key = stored[0]?.key ?? createHash("sha256").update(id).digest().readBigInt64BE();
        const lock = await tx.execute(sql<{ acquired: boolean }>`SELECT pg_try_advisory_xact_lock(${key}) AS acquired`);
        if (lock.rows[0]?.acquired !== true) throw new Error(`Stop the bot before resetting: ${id}`);
      }
      for (const table of [stateChanges, toolExecutions, concernActivities, concerns, reflectionAttempts, reflectionMemoryBatches, agentRuns, events, reflectionRuns, memoryWebEvidence, memorySubjects, memoryMutations, memories, webSnapshots, webResources, scheduledTasks, autonomousSchedules, outboxMessages, messageReceipts, runtimeCorrelations, runtimeRateWindows]) await tx.delete(table);
      for (const { id } of storedAgents) {
      const config = configs.find(config => config.agent.id === id);
      if (!config) throw new Error(`Missing initial Self: ${id}`);
      const { initialState } = config;
      const now = Date.now();
      await tx.insert(autonomousSchedules).values([
        { id: `idle:${id}`, agentId: id, kind: "idle", reason: "一定期間の無活動を契機に、現在のSelf、State、Memoryから行動を検討する", nextDueAt: new Date(now + timings.autonomyReviewIntervalMs) },
        { id: `concern-formation:${id}`, agentId: id, kind: "concern-formation", reason: "Self、経験、関係、探索領域から今後も残る関心を形成する", nextDueAt: new Date(now + (timings.concernFormationIntervalMs ?? timings.autonomyReviewIntervalMs)) },
        { id: `reflection:${id}`, agentId: id, kind: "reflection", reason: "蓄積したEvent logをMemoryと長期状態へ統合する", nextDueAt: new Date(now + timings.stateReviewIntervalMs) }
      ]);
      const initialSelf = initialSelfFromConfig(config);
      const updatedAt = new Date();
      await tx.update(agentStates).set({ disposition: initialSelf.disposition, selfStory: initialSelf.selfStory, commitments: initialSelf.commitments, relationships: initialState.relationships, moodVector: { updatedAt: updatedAt.toISOString(), levels: initialState.mood }, version: 0, updatedAt }).where(eq(agentStates.agentId, id));
      await new ConcernRepository(tx).replace(id, initialState.concerns, updatedAt);
      }
    const suffix = `.before-reset-${randomUUID()}`;
    for (const from of paths) {
      const to = from + suffix;
      try { await rename(from, to); moved.push({ from, to }); }
      catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
    }
      return storedAgents.map(({ id }) => id);
    });
    committed = true;
    return { agents: agentIds, archivedDirectories: moved.map(item => item.to) };
  } catch (error) {
    if (!committed) {
      for (const item of moved.reverse()) await rename(item.to, item.from);
    }
    throw error;
  } finally { /* transaction owns its client */ }
}
