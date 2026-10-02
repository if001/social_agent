import type { Pool, QueryResultRow } from "pg";

import type { ScheduleRepository, ScheduledTarget } from "../../application/scheduler.js";

type DueRow = QueryResultRow & { id: string; agent_id: string; description: string };
export class PostgresScheduleRepository implements ScheduleRepository {
  constructor(private readonly pool: Pool, private readonly leaseMs = 60_000) {}
  async claimDue(now: Date, limit: number): Promise<readonly ScheduledTarget[]> {
    const leasedUntil = new Date(now.getTime() + this.leaseMs);
    const result = await this.pool.query<DueRow>(`WITH due AS (SELECT id FROM intentions WHERE status='active' AND next_review_at IS NOT NULL AND next_review_at <= $1 ORDER BY next_review_at,id FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE intentions i SET next_review_at=$3,updated_at=now() FROM due WHERE i.id=due.id RETURNING i.id,i.agent_id,i.description`, [now, limit, leasedUntil]);
    return result.rows.map((row) => ({ id: row.id, agentId: row.agent_id, kind: "intention", reason: row.description }));
  }
  async complete(targetId: string, nextReviewAt: Date | null): Promise<void> { await this.pool.query("UPDATE intentions SET next_review_at=$2,updated_at=now() WHERE id=$1", [targetId, nextReviewAt]); }
  async release(targetId: string): Promise<void> { await this.pool.query("UPDATE intentions SET next_review_at=now(),updated_at=now() WHERE id=$1", [targetId]); }
}
