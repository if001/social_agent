import type { QueryResultRow } from "pg";

import type { ScheduledTaskRecord, ScheduledTaskToolRepository } from "../tools/scheduled-task-tools.js";
import type { RuntimeDatabase } from "./runtime-database.js";

type Row = QueryResultRow & { id: string; execute_at: Date; instruction: string; reason: string | null; destination: string | null; status: string; attempt: number };
const record = (row: Row): ScheduledTaskRecord => ({ id: row.id, executeAt: row.execute_at, instruction: row.instruction, reason: row.reason, destination: row.destination, status: row.status, attempt: row.attempt });

/** PostgreSQL adapter; Tool definitions only depend on ScheduledTaskToolRepository. */
export class PostgresScheduledTaskToolRepository implements ScheduledTaskToolRepository {
  constructor(private readonly database: RuntimeDatabase) {}
  async create(input: Parameters<ScheduledTaskToolRepository["create"]>[0]): Promise<ScheduledTaskRecord | undefined> {
    const rows = await this.database.native.query<Row>("INSERT INTO scheduled_tasks(id,agent_id,execute_at,instruction,reason,destination,status,attempt,idempotency_key,source_run_id) VALUES($1,$2,$3,$4,$5,$6,'scheduled',0,$7,$8) ON CONFLICT(agent_id,idempotency_key) DO UPDATE SET updated_at=scheduled_tasks.updated_at RETURNING id,execute_at,instruction,reason,destination,status,attempt", [input.id, input.agentId, input.executeAt, input.instruction, input.reason ?? null, input.destination ?? null, input.idempotencyKey, input.runId]);
    return rows.rows[0] === undefined ? undefined : record(rows.rows[0]);
  }
  async list(agentId: string, status: string | undefined, limit: number): Promise<readonly ScheduledTaskRecord[]> { return (await this.database.native.query<Row>("SELECT id,execute_at,instruction,reason,destination,status,attempt FROM scheduled_tasks WHERE agent_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY execute_at DESC,id LIMIT $3", [agentId, status ?? null, limit])).rows.map(record); }
  async cancel(agentId: string, taskId: string): Promise<ScheduledTaskRecord | undefined> { const rows = await this.database.native.query<Row>("UPDATE scheduled_tasks SET status='cancelled',lease_until=NULL,updated_at=now() WHERE id=$1 AND agent_id=$2 AND status='scheduled' RETURNING id,execute_at,instruction,reason,destination,status,attempt", [taskId, agentId]); return rows.rows[0] === undefined ? undefined : record(rows.rows[0]); }
  async update(agentId: string, taskId: string, input: Parameters<ScheduledTaskToolRepository["update"]>[2]): Promise<ScheduledTaskRecord | undefined> { const rows = await this.database.native.query<Row>("UPDATE scheduled_tasks SET execute_at=COALESCE($3,execute_at),instruction=COALESCE($4,instruction),reason=COALESCE($5,reason),destination=COALESCE($6,destination),updated_at=now() WHERE id=$1 AND agent_id=$2 AND status='scheduled' RETURNING id,execute_at,instruction,reason,destination,status,attempt", [taskId, agentId, input.executeAt ?? null, input.instruction ?? null, input.reason ?? null, input.destination ?? null]); return rows.rows[0] === undefined ? undefined : record(rows.rows[0]); }
}
