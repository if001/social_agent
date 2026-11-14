import type { Pool } from "pg";

import type { G3ModelResult, G3Task, G3TaskRepository } from "../../application/g3.js";

export class PostgresG3TaskRepository implements G3TaskRepository {
  constructor(private readonly pool: Pool, private readonly agentId: string) {}
  async save(task: G3Task): Promise<void> {
    const source = await this.pool.query<{ agent_id: string; source_event_id: string; source_run_id: string }>("SELECT agent_id,source_event_id,source_run_id FROM prediction_records WHERE id=$1", [task.sourcePredictionId]);
    const prediction = source.rows[0];
    if (prediction === undefined || prediction.agent_id !== task.agentId || prediction.source_event_id !== task.sourceEventId || prediction.source_run_id !== task.sourceRunId) throw new Error("G3 Task source Prediction does not match its Agent, Event and Run");
    await this.pool.query("INSERT INTO g3_tasks(id,agent_id,source_prediction_id,source_event_id,source_run_id,status,attempt,deadline_at,lease_until,input,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)", [task.id, task.agentId, task.sourcePredictionId, task.sourceEventId, task.sourceRunId, task.status, task.attempt, task.deadlineAt, task.leaseUntil ?? null, JSON.stringify(task.input), task.createdAt]);
  }
  async claim(taskId: string, now: string, leaseUntil: string, maxAttempts: number): Promise<G3Task | undefined> {
    const result = await this.pool.query<G3TaskRow>(`UPDATE g3_tasks SET status=CASE WHEN output IS NULL THEN 'running' ELSE 'result-pending' END,attempt=attempt+1,lease_until=$4,failure_reason=NULL WHERE id=$1 AND agent_id=$2 AND attempt<$5 AND deadline_at>$3 AND source_run_id IS NOT NULL AND (status='pending' OR (status IN ('running','result-pending') AND lease_until<=$3)) RETURNING *`, [taskId, this.agentId, now, leaseUntil, maxAttempts]);
    return result.rows[0] === undefined ? undefined : mapTask(result.rows[0]);
  }
  async claimDue(now: string, leaseUntil: string, maxAttempts: number): Promise<G3Task | undefined> {
    await this.pool.query("UPDATE g3_tasks SET status='failed',failure_reason=CASE WHEN source_run_id IS NULL THEN 'Legacy G3 task has no source Run' WHEN attempt>=$3 THEN 'G3 task attempt limit exceeded' ELSE COALESCE(failure_reason,'G3 task deadline exceeded') END,completed_at=$1,lease_until=NULL WHERE agent_id=$2 AND status IN ('pending','running','result-pending') AND (source_run_id IS NULL OR COALESCE(deadline_at,created_at)<=$1 OR (attempt>=$3 AND (status='pending' OR lease_until<=$1)))", [now, this.agentId, maxAttempts]);
    const result = await this.pool.query<G3TaskRow>(`WITH due AS (SELECT id FROM g3_tasks WHERE agent_id=$3 AND source_run_id IS NOT NULL AND attempt<$4 AND deadline_at>$1 AND (status='pending' OR (status IN ('running','result-pending') AND lease_until<=$1)) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE g3_tasks t SET status=CASE WHEN t.output IS NULL THEN 'running' ELSE 'result-pending' END,attempt=t.attempt+1,lease_until=$2,failure_reason=NULL FROM due WHERE t.id=due.id RETURNING t.*`, [now, leaseUntil, this.agentId, maxAttempts]);
    return result.rows[0] === undefined ? undefined : mapTask(result.rows[0]);
  }
  async saveResult(taskId: string, leaseToken: string, result: G3ModelResult): Promise<boolean> {
    return (await this.pool.query("UPDATE g3_tasks SET status='result-pending',output=$3 WHERE id=$1 AND agent_id=$2 AND status='running' AND lease_until=$4", [taskId, this.agentId, JSON.stringify(result), leaseToken])).rowCount === 1;
  }
  async complete(taskId: string, leaseToken: string, result: G3ModelResult, completedAt: string): Promise<boolean> {
    return (await this.pool.query("UPDATE g3_tasks SET status='completed',output=$3,completed_at=$4,lease_until=NULL WHERE id=$1 AND agent_id=$2 AND status='result-pending' AND lease_until=$5", [taskId, this.agentId, JSON.stringify(result), completedAt, leaseToken])).rowCount === 1;
  }
  async retryOrFail(taskId: string, leaseToken: string, reason: string, now: string, maxAttempts: number): Promise<void> {
    await this.pool.query("UPDATE g3_tasks SET status=CASE WHEN attempt>=$6 OR deadline_at<=$5 THEN 'failed' ELSE 'pending' END,failure_reason=$4,completed_at=CASE WHEN attempt>=$6 OR deadline_at<=$5 THEN $5::timestamptz ELSE NULL END,lease_until=NULL WHERE id=$1 AND agent_id=$2 AND status IN ('running','result-pending') AND lease_until=$3", [taskId, this.agentId, leaseToken, reason, now, maxAttempts]);
  }
}

type G3TaskRow = { id: string; agent_id: string; source_prediction_id: string; source_event_id: string; source_run_id: string; status: G3Task["status"]; attempt: number; deadline_at: Date; lease_until: Date | null; input: G3Task["input"]; output: G3ModelResult | null; created_at: Date; completed_at: Date | null };
const mapTask = (row: G3TaskRow): G3Task => ({ id: row.id, agentId: row.agent_id, sourcePredictionId: row.source_prediction_id, sourceEventId: row.source_event_id, sourceRunId: row.source_run_id, status: row.status, attempt: row.attempt, deadlineAt: row.deadline_at.toISOString(), ...(row.lease_until === null ? {} : { leaseUntil: row.lease_until.toISOString() }), input: row.input, ...(row.output === null ? {} : { output: row.output.output, toolEvidence: row.output.toolEvidence }), createdAt: row.created_at.toISOString(), ...(row.completed_at === null ? {} : { completedAt: row.completed_at.toISOString() }) });
