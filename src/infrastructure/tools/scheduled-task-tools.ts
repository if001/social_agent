import type { Pool, QueryResultRow } from "pg";
import { z } from "zod";

import type { IdGenerator } from "../../application/ports.js";
import type { RegisteredTool } from "../../application/tool-registry.js";
import { DomainError } from "../../domain/contracts.js";

type TaskRow = QueryResultRow & { id: string; execute_at: Date; instruction: string; reason: string | null; destination: string | null; status: string; attempt: number };

const result = (row: TaskRow) => ({ id: row.id, executeAt: row.execute_at.toISOString(), instruction: row.instruction, ...(row.reason === null ? {} : { reason: row.reason }), ...(row.destination === null ? {} : { destination: row.destination }), status: row.status, attempt: row.attempt });
const CreateSchema = z.object({ executeAt: z.iso.datetime({ offset: true }).describe("実行する将来のISO 8601日時"), instruction: z.string().trim().min(1).max(4_000).describe("実行時にAgentへ渡す具体的な指示"), reason: z.string().trim().min(1).max(1_000).optional().describe("予約する理由"), destination: z.string().trim().min(1).max(1_000).optional().describe("実行結果を送る明示的な宛先。通常は省略する") }).strict();
const ListSchema = z.object({ status: z.enum(["scheduled", "running", "completed", "cancelled", "failed"]).optional().describe("指定した状態だけに絞る。全件なら省略する"), limit: z.number().int().min(1).max(50).default(20).describe("返す最大件数") }).strict();
const CancelSchema = z.object({ taskId: z.string().trim().min(1).describe("取り消すScheduled TaskのID") }).strict();

export function createScheduledTaskTools(pool: Pool, ids: IdGenerator, now: () => Date): readonly RegisteredTool[] {
  const create: RegisteredTool<z.infer<typeof CreateSchema>> = {
      name: "schedule_task", description: "明示した将来時刻に実行するTaskを予約する。予約時には処理を実行しない。", resultPolicy: { kind: "standard" },
      schema: CreateSchema,
      execute: async (input, context) => {
        if (context.eventId === undefined) throw new DomainError("VALIDATION", "schedule_task requires an Event context");
        const executeAt = new Date(input.executeAt); if (executeAt.getTime() <= now().getTime()) throw new DomainError("VALIDATION", "executeAt must be in the future");
        const rows = await pool.query<TaskRow>(`INSERT INTO scheduled_tasks(id,agent_id,execute_at,instruction,reason,destination,status,attempt,idempotency_key,source_event_id,source_run_id)
          VALUES($1,$2,$3,$4,$5,$6,'scheduled',0,$7,$8,$9)
          ON CONFLICT(agent_id,idempotency_key) DO UPDATE SET updated_at=scheduled_tasks.updated_at
          RETURNING id,execute_at,instruction,reason,destination,status,attempt`, [ids.next(), context.agentId, executeAt, input.instruction, input.reason ?? null, input.destination ?? null, context.idempotencyKey, context.eventId, context.runId]);
        const row = rows.rows[0]; if (row === undefined) throw new DomainError("EXTERNAL", "Scheduled Task was not stored");
        return { ok: true, value: result(row) };
      }
    };
  const list: RegisteredTool<z.infer<typeof ListSchema>> = {
      name: "scheduled_task_list", description: "自分が所有するScheduled Taskを一覧する。", resultPolicy: { kind: "standard" },
      schema: ListSchema,
      execute: async (input, context) => {
        const rows = await pool.query<TaskRow>(`SELECT id,execute_at,instruction,reason,destination,status,attempt FROM scheduled_tasks WHERE agent_id=$1 AND ($2::text IS NULL OR status=$2) ORDER BY execute_at DESC,id LIMIT $3`, [context.agentId, input.status ?? null, input.limit]);
        return { ok: true, value: { tasks: rows.rows.map(result) } };
      }
    };
  const cancel: RegisteredTool<z.infer<typeof CancelSchema>> = {
      name: "scheduled_task_cancel", description: "自分が所有する未実行のScheduled Taskを取り消す。", resultPolicy: { kind: "standard" },
      schema: CancelSchema,
      execute: async (input, context) => {
        const rows = await pool.query<TaskRow>(`UPDATE scheduled_tasks SET status='cancelled',lease_until=NULL,updated_at=now() WHERE id=$1 AND agent_id=$2 AND status='scheduled' RETURNING id,execute_at,instruction,reason,destination,status,attempt`, [input.taskId, context.agentId]);
        const row = rows.rows[0]; if (row === undefined) throw new DomainError("NOT_FOUND", "Scheduled Task was not found or cannot be cancelled");
        return { ok: true, value: result(row) };
      }
    };
  return [create, list, cancel];
}
