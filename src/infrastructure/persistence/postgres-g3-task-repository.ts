import type { Pool } from "pg";

import type { G3Output, G3Task, G3TaskRepository } from "../../application/g3.js";

export class PostgresG3TaskRepository implements G3TaskRepository {
  constructor(private readonly pool: Pool) {}
  async save(task: G3Task): Promise<void> {
    await this.pool.query("INSERT INTO g3_tasks(id,agent_id,source_prediction_id,source_event_id,status,input,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [task.id, task.agentId, task.sourcePredictionId, task.sourceEventId, task.status, JSON.stringify(task.input), task.createdAt]);
    await this.pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ($1,$2,'internal',$3,'g3','pending',$4) ON CONFLICT (id) DO NOTHING", [`${task.id}:event`, task.agentId, JSON.stringify({ targetKind: "prediction-g3", taskId: task.id, sourcePredictionId: task.sourcePredictionId }), task.createdAt]);
  }
  async complete(taskId: string, output: G3Output, completedAt: string): Promise<void> {
    await this.pool.query("UPDATE g3_tasks SET status='completed',output=$2,completed_at=$3 WHERE id=$1", [taskId, JSON.stringify(output), completedAt]);
    const row = await this.pool.query<{ agent_id: string }>("SELECT agent_id FROM g3_tasks WHERE id=$1", [taskId]);
    const agentId = row.rows[0]?.agent_id;
    if (agentId !== undefined) await this.pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ($1,$2,'internal',$3,'g3','pending',$4) ON CONFLICT (id) DO NOTHING", [`${taskId}:result`, agentId, JSON.stringify({ targetKind: "prediction-g3-result", output }), completedAt]);
  }
  async fail(taskId: string, reason: string, completedAt: string): Promise<void> {
    await this.pool.query("UPDATE g3_tasks SET status='failed',failure_reason=$2,completed_at=$3 WHERE id=$1", [taskId, reason, completedAt]);
  }
}
