import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { and, eq, inArray, like } from "drizzle-orm";

import { createBotComposition } from "../../src/bootstrap/bot-composition.js";
import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";
import { Scheduler } from "../../src/application/scheduler.js";
import { loadConfig } from "../../src/config/config.js";
import { initializeAgent } from "../../src/operations/operations.js";
import { PostgresScheduleRepository } from "../../src/infrastructure/persistence/postgres-schedule-repository.js";
import { createRuntimeDatabase } from "../../src/infrastructure/persistence/runtime-database.js";
import { advisoryLocks, agentFamilies, agents, agentRuns, concernReevaluationBatches, eventExperiences, events, experienceIntegrations, memories, outboxMessages, stateChanges, toolExecutions } from "../../src/infrastructure/persistence/schema.js";
import { UuidGenerator } from "../../src/infrastructure/system.js";

const describeProduction = process.env.LIVE_PRODUCTION_DB_TEST === "true" ? describe : describe.skip;

async function eventually(check: () => Promise<boolean>, timeoutMs = 180_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error("Timed out waiting for production concern-flow verification");
}

async function cleanupVerificationAgent(database: ReturnType<typeof createRuntimeDatabase>, agentId: string): Promise<void> {
  const runs = await database.db.select({ id: agentRuns.id }).from(agentRuns).where(eq(agentRuns.agentId, agentId));
  const runIds = runs.map(({ id }) => id);
  if (runIds.length > 0) {
    await database.db.delete(stateChanges).where(inArray(stateChanges.runId, runIds));
    await database.db.delete(toolExecutions).where(inArray(toolExecutions.runId, runIds));
  }
  await database.db.delete(outboxMessages).where(eq(outboxMessages.agentId, agentId));
  await database.db.delete(agentRuns).where(eq(agentRuns.agentId, agentId));
  await database.db.delete(events).where(eq(events.agentId, agentId));
  await database.db.delete(advisoryLocks).where(eq(advisoryLocks.agentId, agentId));
  await database.db.delete(agents).where(eq(agents.id, agentId));
}

describeProduction("production DB concern flow", () => {
  it("FR-24, FR-25, FR-69, NFR-6, NFR-8: commits a real Agent event, Experience Integration, batch assessment, and due concern flow", async () => {
    const loaded = await loadConfig();
    const suffix = randomUUID(); const agentId = `live-production-${suffix}`; const familyId = `live-production-family-${suffix}`;
    const pool = new Pool({ connectionString: loaded.database.url.replace("postgresql+psycopg://", "postgresql://"), options: "-c search_path=app,public,ext", max: 4 });
    const database = createRuntimeDatabase(pool);
    const published: unknown[] = []; let receive: ((message: never) => Promise<void>) | undefined;
    const queue = { publish: (message: unknown) => { published.push(message); return Promise.resolve(); }, subscribe: (_destination: string, handler: (message: never) => Promise<void>) => { receive = handler; return Promise.resolve(); } };
    try {
      const leftovers = await database.db.select({ id: agents.id, familyId: agents.familyId }).from(agents).where(like(agents.id, "live-production-%"));
      for (const leftover of leftovers) {
        await cleanupVerificationAgent(database, leftover.id);
        await database.db.delete(agentFamilies).where(eq(agentFamilies.id, leftover.familyId));
      }
      await initializeAgent(pool, {
        version: 1,
        family: { id: familyId, name: "Live production verification", sharedDisposition: "経験を確かめる", baseInstruction: "日本語で短く応答する" },
        agent: { id: agentId, identity: "Live Concern Verifier", initialDisposition: "具体的な経験を確かめたい", raisonDetre: "経験が関心を変える流れを検証する", selfNarrative: "検証中", selfContinuity: "経験を次へつなぐ" },
        initialState: { mood: {}, concerns: [{ id: `${agentId}-concern`, description: "展示で音の作品が印象に残る条件を知りたい", whyItMatters: "自分の観察を確かめたい", status: "active" }], relationships: [] }
      }, { autonomyReviewIntervalMs: 86_400_000, concernFormationIntervalMs: 86_400_000, stateReviewIntervalMs: 86_400_000 });
      const config = { ...loaded, botId: agentId, defaultOutputDestination: "live-production-user", runDeadlineMs: Math.max(loaded.runDeadlineMs, 300_000) };
      const composition = createBotComposition({ pool, config, queue, limits: { maxSteps: 8, maxToolCalls: 8 } });
      await composition.runtime.start(new AbortController().signal);
      const now = new Date();
      await composition.runtime.process({ id: `${agentId}-event`, agentId, kind: "user-message", occurredAt: now.toISOString(), payload: { text: "先週、横浜の展示で音の作品を見た。予想より音の変化が気になった。", destination: "live-production-user", senderKind: "human", addressing: "direct", subjectId: "user-main" } }, AbortSignal.timeout(300_000));
      await eventually(async () => (await database.db.select({ id: experienceIntegrations.id }).from(experienceIntegrations).where(and(eq(experienceIntegrations.agentId, agentId), eq(experienceIntegrations.status, "completed"))).limit(1)).length === 1);
      const [experience] = await database.db.select({ id: eventExperiences.eventId }).from(eventExperiences).where(eq(eventExperiences.agentId, agentId)).limit(1);
      expect(experience).toBeDefined();
      const written = await database.db.select({ id: memories.id }).from(memories).where(eq(memories.agentId, agentId));
      expect(written.length).toBeGreaterThan(0);
      const batches = await database.db.select({ id: concernReevaluationBatches.id, status: concernReevaluationBatches.status }).from(concernReevaluationBatches).where(eq(concernReevaluationBatches.agentId, agentId));
      expect(batches).toHaveLength(1);
      const pending = batches.find(({ status }) => status === "pending");
      if (pending !== undefined) {
        await database.db.update(concernReevaluationBatches).set({ nextDueAt: new Date() }).where(eq(concernReevaluationBatches.id, pending.id));
        const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready");
        const scheduler = new Scheduler({ repository: new PostgresScheduleRepository(database, 60_000, agentId), runtime: composition.runtime, clock: composition.clock, ids: new UuidGenerator(), lifecycle, defaultDestination: () => "live-production-user", autonomyReviewIntervalMs: 86_400_000, concernFormationIntervalMs: 86_400_000, stateReviewIntervalMs: 86_400_000 });
        await scheduler.tick(AbortSignal.timeout(300_000));
        expect((await database.db.select({ status: concernReevaluationBatches.status }).from(concernReevaluationBatches).where(eq(concernReevaluationBatches.id, pending.id)).limit(1))[0]?.status).toBe("consumed");
      }
      expect(published).toBeDefined(); expect(receive).toBeDefined();
    } finally {
      await cleanupVerificationAgent(database, agentId);
      await database.db.delete(agentFamilies).where(eq(agentFamilies.id, familyId));
      await pool.end();
    }
  }, 600_000);
});
