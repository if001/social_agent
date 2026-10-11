import type { Pool, QueryResultRow } from "pg";

import type { ScheduleRepository, ScheduledTarget } from "../../application/scheduler.js";

type DueCandidateRow = QueryResultRow & { id: string; agent_id: string; target: string; reason: string };
type DueAutonomousRow = QueryResultRow & { id: string; agent_id: string; kind: "state-review" | "memory-recall" | "autonomy-review"; reason: string };
type DueTaskRow = QueryResultRow & { id: string; agent_id: string; instruction: string; reason: string | null; destination: string | null };

export class PostgresScheduleRepository implements ScheduleRepository {
  constructor(private readonly pool: Pool, private readonly leaseMs = 60_000, private readonly agentId?: string, private readonly retryDelayMs = 300_000) {}
  async claimDue(now: Date, limit: number): Promise<readonly ScheduledTarget[]> {
    const client = await this.pool.connect(); const leasedUntil = new Date(now.getTime() + this.leaseMs);
    try {
      await client.query("BEGIN");
      const tasks = await client.query<DueTaskRow>(`WITH due AS (SELECT id FROM scheduled_tasks WHERE status='scheduled' AND execute_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) AND ($4::text IS NULL OR agent_id=$4) ORDER BY execute_at,id FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE scheduled_tasks t SET status='running',lease_until=$3,attempt=t.attempt+1,updated_at=now() FROM due WHERE t.id=due.id RETURNING t.id,t.agent_id,t.instruction,t.reason,t.destination`, [now, limit, leasedUntil, this.agentId ?? null]);
      const remainingAfterTasks = Math.max(0, limit - tasks.rows.length);
      const autonomous = remainingAfterTasks === 0 ? { rows: [] as DueAutonomousRow[] } : await client.query<DueAutonomousRow>(`WITH due AS (SELECT id FROM autonomous_schedules WHERE kind=ANY($5::text[]) AND next_due_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) AND ($4::text IS NULL OR agent_id=$4) ORDER BY next_due_at,id FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE autonomous_schedules s SET lease_until=$3,updated_at=now() FROM due WHERE s.id=due.id RETURNING s.id,s.agent_id,s.kind,s.reason`, [now, remainingAfterTasks, leasedUntil, this.agentId ?? null, ["state-review", "memory-recall", "autonomy-review"]]);
      const remaining = Math.max(0, remainingAfterTasks - autonomous.rows.length);
      const candidates = remaining === 0 ? { rows: [] as DueCandidateRow[] } : await client.query<DueCandidateRow>("SELECT id,agent_id,target,reason FROM long_term_candidates WHERE status='pending' AND review_after IS NOT NULL AND review_after<=$1 AND (review_lease_until IS NULL OR review_lease_until<=$1) AND ($3::text IS NULL OR agent_id=$3) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $2", [now, remaining, this.agentId ?? null]);
      if (candidates.rows.length > 0) await client.query("UPDATE long_term_candidates SET review_lease_until=$2,updated_at=now() WHERE id=ANY($1::text[])", [candidates.rows.map(({ id }) => id), leasedUntil]);
      await client.query("COMMIT");
      const grouped = new Map<string, DueCandidateRow[]>();
      for (const row of candidates.rows) { const key = `${row.agent_id}:${row.target}`; grouped.set(key, [...(grouped.get(key) ?? []), row]); }
      return [
        ...tasks.rows.map((row): ScheduledTarget => ({ id: row.id, agentId: row.agent_id, kind: "scheduled-task", reason: row.reason ?? "Scheduled Taskの期限到来", instruction: row.instruction, ...(row.destination === null ? {} : { destination: row.destination }) })),
        ...autonomous.rows.map((row): ScheduledTarget => ({ id: row.id, agentId: row.agent_id, kind: row.kind, reason: row.reason })),
        ...[...grouped.values()].map((rows): ScheduledTarget => ({ id: rows[0]?.id ?? "", agentId: rows[0]?.agent_id ?? "", kind: "long-term-review", reason: rows.map(({ reason }) => reason).join("; "), candidateIds: rows.map(({ id }) => id) }))
      ];
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async complete(target: ScheduledTarget, nextReviewAt: Date | null, executionEventId?: string): Promise<void> {
    if (target.kind === "scheduled-task") { await this.pool.query("UPDATE scheduled_tasks SET status='completed',lease_until=NULL,failure_reason=NULL,execution_event_id=$3,updated_at=now() WHERE id=$1 AND agent_id=$2", [target.id, target.agentId, executionEventId ?? null]); return; }
    if (target.kind === "long-term-review") { await this.pool.query("UPDATE long_term_candidates SET review_lease_until=NULL,updated_at=now() WHERE id=ANY($1::text[])", [target.candidateIds]); return; }
    await this.pool.query("UPDATE autonomous_schedules SET lease_until=NULL,next_due_at=COALESCE($2,now()+interval '1 day'),updated_at=now() WHERE id=$1", [target.id, nextReviewAt]);
  }
  async release(target: ScheduledTarget): Promise<void> {
    if (target.kind === "scheduled-task") { await this.pool.query("UPDATE scheduled_tasks SET status=CASE WHEN attempt>=3 THEN 'failed' ELSE 'scheduled' END,execute_at=CASE WHEN attempt>=3 THEN execute_at ELSE now()+$3*interval '1 millisecond' END,lease_until=NULL,failure_reason='Scheduled Task execution failed',updated_at=now() WHERE id=$1 AND agent_id=$2", [target.id, target.agentId, this.retryDelayMs]); return; }
    if (target.kind === "long-term-review") { await this.pool.query("UPDATE long_term_candidates SET review_lease_until=NULL,review_after=now(),updated_at=now() WHERE id=ANY($1::text[])", [target.candidateIds]); return; }
    await this.pool.query("UPDATE autonomous_schedules SET lease_until=NULL,next_due_at=now()+$2*interval '1 millisecond',updated_at=now() WHERE id=$1", [target.id, this.retryDelayMs]);
  }
}
