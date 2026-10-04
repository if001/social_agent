import type { Pool, QueryResultRow } from "pg";

import type { ScheduleRepository, ScheduledTarget } from "../../application/scheduler.js";

type DueIntentionRow = QueryResultRow & { id: string; agent_id: string; description: string };
type DueCandidateRow = QueryResultRow & { id: string; agent_id: string; target: string; reason: string };
type DueAutonomousRow = QueryResultRow & { id: string; agent_id: string; kind: "persistent-drive" | "state-review"; reason: string };

export class PostgresScheduleRepository implements ScheduleRepository {
  constructor(private readonly pool: Pool, private readonly leaseMs = 60_000, private readonly agentId?: string) {}
  async claimDue(now: Date, limit: number): Promise<readonly ScheduledTarget[]> {
    const client = await this.pool.connect(); const leasedUntil = new Date(now.getTime() + this.leaseMs);
    try {
      await client.query("BEGIN");
      const intentions = await client.query<DueIntentionRow>(`WITH due AS (SELECT id FROM intentions WHERE status='active' AND next_review_at IS NOT NULL AND next_review_at <= $1 AND ($4::text IS NULL OR agent_id=$4) ORDER BY next_review_at,id FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE intentions i SET next_review_at=$3,updated_at=now() FROM due WHERE i.id=due.id RETURNING i.id,i.agent_id,i.description`, [now, limit, leasedUntil, this.agentId ?? null]);
      const remainingAfterIntentions = Math.max(0, limit - intentions.rows.length);
      const autonomous = remainingAfterIntentions === 0 ? { rows: [] as DueAutonomousRow[] } : await client.query<DueAutonomousRow>(`WITH due AS (SELECT id FROM autonomous_schedules WHERE next_due_at<=$1 AND (lease_until IS NULL OR lease_until<=$1) AND ($4::text IS NULL OR agent_id=$4) ORDER BY next_due_at,id FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE autonomous_schedules s SET lease_until=$3,updated_at=now() FROM due WHERE s.id=due.id RETURNING s.id,s.agent_id,s.kind,s.reason`, [now, remainingAfterIntentions, leasedUntil, this.agentId ?? null]);
      const remaining = Math.max(0, remainingAfterIntentions - autonomous.rows.length);
      const candidates = remaining === 0 ? { rows: [] as DueCandidateRow[] } : await client.query<DueCandidateRow>("SELECT id,agent_id,target,reason FROM long_term_candidates WHERE status='pending' AND review_after IS NOT NULL AND review_after<=$1 AND (review_lease_until IS NULL OR review_lease_until<=$1) AND ($3::text IS NULL OR agent_id=$3) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $2", [now, remaining, this.agentId ?? null]);
      if (candidates.rows.length > 0) await client.query("UPDATE long_term_candidates SET review_lease_until=$2,updated_at=now() WHERE id=ANY($1::text[])", [candidates.rows.map(({ id }) => id), leasedUntil]);
      await client.query("COMMIT");
      const grouped = new Map<string, DueCandidateRow[]>();
      for (const row of candidates.rows) { const key = `${row.agent_id}:${row.target}`; grouped.set(key, [...(grouped.get(key) ?? []), row]); }
      return [
        ...intentions.rows.map((row): ScheduledTarget => ({ id: row.id, agentId: row.agent_id, kind: "intention", reason: row.description })),
        ...autonomous.rows.map((row): ScheduledTarget => ({ id: row.id, agentId: row.agent_id, kind: row.kind, reason: row.reason })),
        ...[...grouped.values()].map((rows): ScheduledTarget => ({ id: rows[0]?.id ?? "", agentId: rows[0]?.agent_id ?? "", kind: "long-term-review", reason: rows.map(({ reason }) => reason).join("; "), candidateIds: rows.map(({ id }) => id) }))
      ];
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async complete(target: ScheduledTarget, nextReviewAt: Date | null): Promise<void> {
    if (target.kind === "long-term-review") { await this.pool.query("UPDATE long_term_candidates SET review_lease_until=NULL,updated_at=now() WHERE id=ANY($1::text[])", [target.candidateIds ?? [target.id]]); return; }
    if (target.kind === "persistent-drive" || target.kind === "state-review") { await this.pool.query("UPDATE autonomous_schedules SET lease_until=NULL,next_due_at=COALESCE($2,now()+interval '1 day'),updated_at=now() WHERE id=$1", [target.id, nextReviewAt]); return; }
    await this.pool.query("UPDATE intentions SET next_review_at=$2,updated_at=now() WHERE id=$1", [target.id, nextReviewAt]);
  }
  async release(target: ScheduledTarget): Promise<void> {
    if (target.kind === "long-term-review") { await this.pool.query("UPDATE long_term_candidates SET review_lease_until=NULL,review_after=now(),updated_at=now() WHERE id=ANY($1::text[])", [target.candidateIds ?? [target.id]]); return; }
    if (target.kind === "persistent-drive" || target.kind === "state-review") { await this.pool.query("UPDATE autonomous_schedules SET lease_until=NULL,next_due_at=now()+interval '5 minutes',updated_at=now() WHERE id=$1", [target.id]); return; }
    await this.pool.query("UPDATE intentions SET next_review_at=now(),updated_at=now() WHERE id=$1", [target.id]);
  }
}
