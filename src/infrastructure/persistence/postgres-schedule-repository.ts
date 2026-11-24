import { and, desc, eq, sql } from "drizzle-orm";

import type { ScheduleRepository, ScheduledTarget } from "../../application/scheduler.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { autonomousSchedules, concernReevaluationSignals, reflectionRuns, scheduledTasks } from "./schema.js";

type DueAutonomousRow = { id: string; agent_id: string; kind: "idle" | "concern-formation" | "reflection"; reason: string };
type DueConcernSignalRow = { agent_id: string; reason: string; claimed_at: Date | string };
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
      let signalRows: DueConcernSignalRow[] = [];
      if (signalRemaining > 0) {
        const signals = await tx.execute(sql<DueConcernSignalRow>`WITH due AS (
          SELECT agent_id FROM app.concern_reevaluation_signals WHERE next_due_at<=${now}
          AND (lease_until IS NULL OR lease_until<=${now})
          AND (${this.agentId ?? null}::text IS NULL OR agent_id=${this.agentId ?? null})
          ORDER BY next_due_at,agent_id FOR UPDATE SKIP LOCKED LIMIT ${signalRemaining}
        ) UPDATE app.concern_reevaluation_signals s SET lease_until=${leasedUntil},updated_at=${now}
          FROM due WHERE s.agent_id=due.agent_id RETURNING s.agent_id,s.reason,s.updated_at AS claimed_at`);
        signalRows = signals.rows as unknown as DueConcernSignalRow[];
      }
      return [
        ...taskRows.map((row): ScheduledTarget => ({ id: row.id, agentId: row.agent_id, kind: "scheduled-task", reason: row.reason ?? "Scheduled Taskの期限到来", instruction: row.instruction, ...(row.destination === null ? {} : { destination: row.destination }) })),
        ...autonomousRows.map((row): ScheduledTarget => ({ id: row.id, agentId: row.agent_id, kind: row.kind, reason: row.reason })),
        ...signalRows.map((row): ScheduledTarget => ({ id: `concern-due:${row.agent_id}`, agentId: row.agent_id, kind: "concern-due", reason: row.reason, signalClaimedAt: new Date(row.claimed_at) }))
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
      const removed = await this.database.db.delete(concernReevaluationSignals).where(and(
        eq(concernReevaluationSignals.agentId, target.agentId),
        eq(concernReevaluationSignals.updatedAt, target.signalClaimedAt)
      )).returning({ agentId: concernReevaluationSignals.agentId });
      // A producer wrote a newer source while this claim was running.  Keep it
      // pending and let a future tick process that newer evidence.
      if (removed.length === 0) await this.database.db.update(concernReevaluationSignals).set({
        leaseUntil: null, nextDueAt: new Date(), updatedAt: new Date()
      }).where(eq(concernReevaluationSignals.agentId, target.agentId));
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
      await this.database.db.update(concernReevaluationSignals).set({
        leaseUntil: null, nextDueAt: new Date(Date.now() + this.retryDelayMs), updatedAt: new Date()
      }).where(eq(concernReevaluationSignals.agentId, target.agentId));
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
