import type { Pool, QueryResultRow } from "pg";

import type { ScheduleRepository, ScheduledTarget } from "../../application/scheduler.js";

type DueIntentionRow = QueryResultRow & { id: string; agent_id: string; description: string };
type DueCandidateRow = QueryResultRow & { id: string; agent_id: string; target: string; reason: string };

export class PostgresScheduleRepository implements ScheduleRepository {
  constructor(private readonly pool: Pool, private readonly leaseMs = 60_000) {}
  async claimDue(now: Date, limit: number): Promise<readonly ScheduledTarget[]> {
    const client = await this.pool.connect(); const leasedUntil = new Date(now.getTime() + this.leaseMs);
    try {
      await client.query("BEGIN");
      const intentions = await client.query<DueIntentionRow>(`WITH due AS (SELECT id FROM intentions WHERE status='active' AND next_review_at IS NOT NULL AND next_review_at <= $1 ORDER BY next_review_at,id FOR UPDATE SKIP LOCKED LIMIT $2) UPDATE intentions i SET next_review_at=$3,updated_at=now() FROM due WHERE i.id=due.id RETURNING i.id,i.agent_id,i.description`, [now, limit, leasedUntil]);
      const remaining = Math.max(0, limit - intentions.rows.length);
      const candidates = remaining === 0 ? { rows: [] as DueCandidateRow[] } : await client.query<DueCandidateRow>("SELECT id,agent_id,target,reason FROM long_term_candidates WHERE status='pending' AND (review_after IS NULL OR review_after<=$1) AND (review_lease_until IS NULL OR review_lease_until<=$1) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT $2", [now, remaining]);
      if (candidates.rows.length > 0) await client.query("UPDATE long_term_candidates SET review_lease_until=$2,updated_at=now() WHERE id=ANY($1::text[])", [candidates.rows.map(({ id }) => id), leasedUntil]);
      await client.query("COMMIT");
      const grouped = new Map<string, DueCandidateRow[]>();
      for (const row of candidates.rows) { const key = `${row.agent_id}:${row.target}`; grouped.set(key, [...(grouped.get(key) ?? []), row]); }
      return [
        ...intentions.rows.map((row): ScheduledTarget => ({ id: row.id, agentId: row.agent_id, kind: "intention", reason: row.description })),
        ...[...grouped.values()].map((rows): ScheduledTarget => ({ id: rows[0]?.id ?? "", agentId: rows[0]?.agent_id ?? "", kind: "long-term-review", reason: rows.map(({ reason }) => reason).join("; "), candidateIds: rows.map(({ id }) => id) }))
      ];
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async complete(target: ScheduledTarget, nextReviewAt: Date | null): Promise<void> {
    if (target.kind === "long-term-review") { await this.pool.query("UPDATE long_term_candidates SET review_lease_until=NULL,review_after=NULL,updated_at=now() WHERE id=ANY($1::text[])", [target.candidateIds ?? [target.id]]); return; }
    await this.pool.query("UPDATE intentions SET next_review_at=$2,updated_at=now() WHERE id=$1", [target.id, nextReviewAt]);
  }
  async release(target: ScheduledTarget): Promise<void> {
    if (target.kind === "long-term-review") { await this.pool.query("UPDATE long_term_candidates SET review_lease_until=NULL,review_after=now(),updated_at=now() WHERE id=ANY($1::text[])", [target.candidateIds ?? [target.id]]); return; }
    await this.pool.query("UPDATE intentions SET next_review_at=now(),updated_at=now() WHERE id=$1", [target.id]);
  }
}
