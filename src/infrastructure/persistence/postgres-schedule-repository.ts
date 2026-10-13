import type { Pool, QueryResultRow } from "pg";

import type { ExplorationMode, ScheduleRepository, ScheduledTarget } from "../../application/scheduler.js";

type DueAutonomousRow = QueryResultRow & { id: string; agent_id: string; kind: "idle" | "concern-due" | "external-change" | "reflection"; reason: string; exploration_mode: ExplorationMode };
type DueTaskRow = QueryResultRow & { id: string; agent_id: string; instruction: string; reason: string | null; destination: string | null };

export class PostgresScheduleRepository implements ScheduleRepository {
  constructor(private readonly pool: Pool, private readonly leaseMs = 60_000, private readonly agentId?: string, private readonly retryDelayMs = 300_000) {}
  async claimDue(now: Date, limit: number): Promise<readonly ScheduledTarget[]> {
    const client = await this.pool.connect(); const leasedUntil = new Date(now.getTime() + this.leaseMs);
    try {
      await client.query("BEGIN");
      const tasks = await client.query<DueTaskRow>(`WITH due AS (SELECT id FROM scheduled_tasks WHERE status='scheduled' AND execute_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) AND ($4::text IS NULL OR agent_id=$4) ORDER BY execute_at,id FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE scheduled_tasks t SET status='running',lease_until=$3,attempt=t.attempt+1,updated_at=now() FROM due WHERE t.id=due.id RETURNING t.id,t.agent_id,t.instruction,t.reason,t.destination`, [now, limit, leasedUntil, this.agentId ?? null]);
      const remainingAfterTasks = Math.max(0, limit - tasks.rows.length);
      const autonomous = remainingAfterTasks === 0 ? { rows: [] as DueAutonomousRow[] } : await client.query<DueAutonomousRow>(`WITH due AS (SELECT id FROM autonomous_schedules WHERE kind=ANY($5::text[]) AND next_due_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) AND ($4::text IS NULL OR agent_id=$4) ORDER BY next_due_at,id FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE autonomous_schedules s SET lease_until=$3,updated_at=now() FROM due WHERE s.id=due.id RETURNING s.id,s.agent_id,s.kind,s.reason,s.exploration_mode`, [now, remainingAfterTasks, leasedUntil, this.agentId ?? null, ["idle", "concern-due", "external-change", "reflection"]]);
      await client.query("COMMIT");
      return [
        ...tasks.rows.map((row): ScheduledTarget => ({ id: row.id, agentId: row.agent_id, kind: "scheduled-task", reason: row.reason ?? "Scheduled Taskの期限到来", instruction: row.instruction, ...(row.destination === null ? {} : { destination: row.destination }) })),
        ...autonomous.rows.map((row): ScheduledTarget => row.kind === "idle"
          ? { id: row.id, agentId: row.agent_id, kind: "idle", reason: row.reason, explorationMode: row.exploration_mode }
          : { id: row.id, agentId: row.agent_id, kind: row.kind, reason: row.reason })
      ];
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async complete(target: ScheduledTarget, nextReviewAt: Date | null, executionEventId?: string): Promise<void> {
    if (target.kind === "scheduled-task") { await this.pool.query("UPDATE scheduled_tasks SET status='completed',lease_until=NULL,failure_reason=NULL,execution_event_id=$3,updated_at=now() WHERE id=$1 AND agent_id=$2", [target.id, target.agentId, executionEventId ?? null]); return; }
    await this.pool.query("UPDATE autonomous_schedules SET lease_until=NULL,next_due_at=COALESCE($2,now()+interval '1 day'),exploration_mode=CASE WHEN kind='idle' THEN CASE exploration_mode WHEN 'deepen' THEN 'bridge' WHEN 'bridge' THEN 'distant' ELSE 'deepen' END ELSE exploration_mode END,updated_at=now() WHERE id=$1", [target.id, nextReviewAt]);
  }
  async release(target: ScheduledTarget): Promise<void> {
    if (target.kind === "scheduled-task") { await this.pool.query("UPDATE scheduled_tasks SET status=CASE WHEN attempt>=3 THEN 'failed' ELSE 'scheduled' END,execute_at=CASE WHEN attempt>=3 THEN execute_at ELSE now()+$3*interval '1 millisecond' END,lease_until=NULL,failure_reason='Scheduled Task execution failed',updated_at=now() WHERE id=$1 AND agent_id=$2", [target.id, target.agentId, this.retryDelayMs]); return; }
    if (target.kind === "reflection") {
      const failures = await this.pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM reflection_runs r
        WHERE r.agent_id=$1 AND r.status='failed'
        AND r.created_at>COALESCE((SELECT max(completed_at) FROM reflection_runs WHERE agent_id=$1 AND status='completed'),'-infinity'::timestamptz)`, [target.agentId]);
      const consecutiveFailures = Number.parseInt(failures.rows[0]?.count ?? "1", 10);
      const delayMs = Math.min(86_400_000, this.retryDelayMs * 2 ** Math.min(8, Math.max(0, consecutiveFailures - 1)));
      await this.pool.query("UPDATE autonomous_schedules SET lease_until=NULL,next_due_at=now()+$2*interval '1 millisecond',updated_at=now() WHERE id=$1", [target.id, delayMs]);
      return;
    }
    await this.pool.query("UPDATE autonomous_schedules SET lease_until=NULL,next_due_at=now()+$2*interval '1 millisecond',updated_at=now() WHERE id=$1", [target.id, this.retryDelayMs]);
  }
}
