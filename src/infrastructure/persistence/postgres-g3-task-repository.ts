import type { Pool } from "pg";

import type { G3Output, G3Task, G3TaskRepository } from "../../application/g3.js";

export class PostgresG3TaskRepository implements G3TaskRepository {
  constructor(private readonly pool: Pool) {}
  async save(task: G3Task): Promise<void> {
    await this.pool.query("INSERT INTO g3_tasks(id,agent_id,source_prediction_id,source_event_id,status,input,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [task.id, task.agentId, task.sourcePredictionId, task.sourceEventId, task.status, JSON.stringify(task.input), task.createdAt]);
  }
  async complete(taskId: string, output: G3Output, completedAt: string): Promise<void> {
    await this.pool.query("UPDATE g3_tasks SET status='completed',output=$2,completed_at=$3 WHERE id=$1", [taskId, JSON.stringify(output), completedAt]);
  }
  async fail(taskId: string, reason: string, completedAt: string): Promise<void> {
    await this.pool.query("UPDATE g3_tasks SET status='failed',failure_reason=$2,completed_at=$3 WHERE id=$1", [taskId, reason, completedAt]);
  }
}
