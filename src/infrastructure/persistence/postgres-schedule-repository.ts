import { and, desc, eq, inArray, sql } from "drizzle-orm";

import type { ScheduleRepository, ScheduledTarget } from "../../application/scheduler.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { autonomousSchedules, concernReevaluationBatches, concernReevaluationBatchMemories, concerns, eventExperiences, memories, reflectionRuns, scheduledTasks } from "./schema.js";

type DueAutonomousRow = { id: string; agent_id: string; kind: "idle" | "concern-formation" | "reflection"; reason: string };
type DueConcernBatchRow = { id: string; agent_id: string; focus_concern_id: string; description: string; why_it_matters: string; impact_reason: string | null; source_event_id: string | null };
type DueTaskRow = { id: string; agent_id: string; instruction: string; reason: string | null; destination: string | null };

export class PostgresScheduleRepository implements ScheduleRepository {
  constructor(private readonly database: RuntimeDatabase, private readonly leaseMs = 60_000, private readonly agentId?: string, private readonly retryDelayMs = 300_000) {}

  async claimDue(now: Date, limit: number): Promise<readonly ScheduledTarget[]> {
    const leasedUntil = new Date(now.getTime() + this.leaseMs);
    return this.database.transaction(async (tx) => {
      // PostgreSQL-native: concurrent scheduler workers require SKIP LOCKED.
      const tasks = await tx.execute(sql<DueTaskRow>`WITH due AS (
        SELECT id FROM app.scheduled_tasks WHERE status='scheduled' AND execute_at<=${now}
        AND (lease_until IS NULL OR lease_until<=${now})
        AND (${this.agentId ?? null}::text IS NULL OR agent_id=${this.agentId ?? null})
        ORDER BY execute_at,id FOR UPDATE SKIP LOCKED LIMIT ${limit}
      ) UPDATE app.scheduled_tasks t SET status='running',lease_until=${leasedUntil},attempt=t.attempt+1,updated_at=now()
        FROM due WHERE t.id=due.id RETURNING t.id,t.agent_id,t.instruction,t.reason,t.destination`);
      const taskRows = tasks.rows as unknown as DueTaskRow[];
      const remaining = Math.max(0, limit - taskRows.length);
      let autonomousRows: DueAutonomousRow[] = [];
      if (remaining > 0) {
        const autonomous = await tx.execute(sql<DueAutonomousRow>`WITH due AS (
          SELECT id FROM app.autonomous_schedules WHERE kind IN ('idle','concern-formation','reflection')
          AND next_due_at<=${now} AND (lease_until IS NULL OR lease_until<=${now})
          AND (${this.agentId ?? null}::text IS NULL OR agent_id=${this.agentId ?? null})
          ORDER BY next_due_at,id FOR UPDATE SKIP LOCKED LIMIT ${remaining}
        ) UPDATE app.autonomous_schedules s SET lease_until=${leasedUntil},updated_at=now()
          FROM due WHERE s.id=due.id RETURNING s.id,s.agent_id,s.kind,s.reason`);
        autonomousRows = autonomous.rows as unknown as DueAutonomousRow[];
      }
      const signalRemaining = Math.max(0, remaining - autonomousRows.length);
      let signalRows: DueConcernBatchRow[] = [];
      if (signalRemaining > 0) {
        const signals = await tx.execute(sql<DueConcernBatchRow>`WITH due AS (
          SELECT id,agent_id,focus_concern_id FROM app.concern_reevaluation_batches WHERE status='pending' AND next_due_at<=${now}
          AND (lease_until IS NULL OR lease_until<=${now}) AND focus_concern_id IS NOT NULL
          AND (${this.agentId ?? null}::text IS NULL OR agent_id=${this.agentId ?? null})
          ORDER BY agent_id,next_due_at,id FOR UPDATE SKIP LOCKED LIMIT ${signalRemaining}
        ) UPDATE app.concern_reevaluation_batches b SET status='claimed',lease_until=${leasedUntil},claimed_at=${now},updated_at=${now}
          FROM due JOIN app.concerns c ON c.id=due.focus_concern_id WHERE b.agent_id=due.agent_id AND b.focus_concern_id=due.focus_concern_id AND b.status='pending' AND b.next_due_at<=${now}
          RETURNING b.id,b.agent_id,b.focus_concern_id,c.description,c.why_it_matters,b.impact_reason,b.source_event_id`);
        signalRows = signals.rows as unknown as DueConcernBatchRow[];
      }
      const groupedSignals = [...signalRows.reduce((groups, row) => { const key = `${row.agent_id}:${row.focus_concern_id}`; const values = groups.get(key) ?? []; values.push(row); groups.set(key, values); return groups; }, new Map<string, DueConcernBatchRow[]>()).values()];
      const signalTargets = await Promise.all(groupedSignals.map(async (rows): Promise<ScheduledTarget | undefined> => {
        const first = rows[0]; if (first === undefined) return undefined;
        const batchIds = rows.map(({ id }) => id);
        const memoryRows = await tx.select({ id: memories.id, content: memories.content }).from(concernReevaluationBatchMemories)
          .innerJoin(memories, eq(memories.id, concernReevaluationBatchMemories.memoryId))
          .where(inArray(concernReevaluationBatchMemories.batchId, batchIds)).orderBy(desc(memories.updatedAt), desc(memories.id)).limit(16);
        const sourceEventIds = rows.flatMap((row) => row.source_event_id === null ? [] : [row.source_event_id]);
        const experienceRows = sourceEventIds.length === 0 ? [] : await tx.select({ summary: eventExperiences.summary })
          .from(eventExperiences).where(inArray(eventExperiences.eventId, sourceEventIds)).limit(8);
        const experienceSummaries = experienceRows.length > 0 ? experienceRows.map(({ summary }) => summary) : memoryRows.map(({ content }) => content.slice(0, 400));
        return { id: `concern-due:${first.agent_id}:${first.focus_concern_id}`, agentId: first.agent_id, kind: "concern-due", reason: first.impact_reason ?? "新しい経験がConcernの派生を促した", batchIds, focusConcernId: first.focus_concern_id, focusConcern: { description: first.description, whyItMatters: first.why_it_matters }, evidenceMemoryIds: memoryRows.map(({ id }) => id), experienceSummaries };
      }));
      return [
        ...taskRows.map((row): ScheduledTarget => ({ id: row.id, agentId: row.agent_id, kind: "scheduled-task", reason: row.reason ?? "Scheduled Taskの期限到来", instruction: row.instruction, ...(row.destination === null ? {} : { destination: row.destination }) })),
        ...autonomousRows.map((row): ScheduledTarget => ({ id: row.id, agentId: row.agent_id, kind: row.kind, reason: row.reason })),
        ...signalTargets.flatMap((target): ScheduledTarget[] => target === undefined ? [] : [target])
      ];
    });
  }

  async complete(target: ScheduledTarget, nextReviewAt: Date | null, executionEventId?: string): Promise<void> {
    if (target.kind === "scheduled-task") {
      await this.database.db.update(scheduledTasks).set({
        status: "completed", leaseUntil: null, failureReason: null,
        executionEventId: executionEventId ?? null, updatedAt: new Date()
      }).where(and(eq(scheduledTasks.id, target.id), eq(scheduledTasks.agentId, target.agentId)));
      return;
    }
    if (target.kind === "concern-due") {
      await this.database.db.update(concernReevaluationBatches).set({ status: "consumed", consumedAt: new Date(), leaseUntil: null, updatedAt: new Date() }).where(inArray(concernReevaluationBatches.id, [...target.batchIds]));
      return;
    }
    await this.database.db.update(autonomousSchedules).set({
      leaseUntil: null, nextDueAt: nextReviewAt ?? new Date(Date.now() + 86_400_000), updatedAt: new Date()
    }).where(eq(autonomousSchedules.id, target.id));
  }

  async release(target: ScheduledTarget): Promise<void> {
    if (target.kind === "scheduled-task") {
      await this.database.db.update(scheduledTasks).set({
        status: sql`CASE WHEN ${scheduledTasks.attempt}>=3 THEN 'failed' ELSE 'scheduled' END`,
        executeAt: sql`CASE WHEN ${scheduledTasks.attempt}>=3 THEN ${scheduledTasks.executeAt} ELSE now()+${this.retryDelayMs}*interval '1 millisecond' END`,
        leaseUntil: null, failureReason: "Scheduled Task execution failed", updatedAt: new Date()
      }).where(and(eq(scheduledTasks.id, target.id), eq(scheduledTasks.agentId, target.agentId)));
      return;
    }
    if (target.kind === "concern-due") {
      await this.database.db.update(concernReevaluationBatches).set({ status: "pending", leaseUntil: null, nextDueAt: new Date(Date.now() + this.retryDelayMs), updatedAt: new Date() }).where(inArray(concernReevaluationBatches.id, [...target.batchIds]));
      return;
    }
    if (target.kind === "reflection") {
      await this.database.transaction(async (tx) => {
        const retry = (await tx.select({ id: reflectionRuns.id }).from(reflectionRuns).where(and(
          eq(reflectionRuns.agentId, target.agentId),
          sql`(${reflectionRuns.status}='failed' OR (${reflectionRuns.status}='pending' AND ${reflectionRuns.failureReason}='Reflection has retryable target failures'))`
        )).orderBy(desc(reflectionRuns.updatedAt), desc(reflectionRuns.id)).limit(1))[0];
        if (retry !== undefined) await tx.update(reflectionRuns).set({
          retryCount: sql`${reflectionRuns.retryCount}+1`, updatedAt: new Date()
        }).where(eq(reflectionRuns.id, retry.id));
        // Debug configuration intentionally retries immediately.  Use one
        // timestamp for both fields so an immediate retry is never negative.
        const retryAt = new Date();
        await tx.update(autonomousSchedules).set({ leaseUntil: null, nextDueAt: retryAt, updatedAt: retryAt })
          .where(eq(autonomousSchedules.id, target.id));
      });
      return;
    }
    await this.database.db.update(autonomousSchedules).set({
      leaseUntil: null, nextDueAt: new Date(Date.now() + this.retryDelayMs), updatedAt: new Date()
    }).where(eq(autonomousSchedules.id, target.id));
  }
}
