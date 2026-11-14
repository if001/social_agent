import { z } from "zod";

import type { IdGenerator } from "../../application/ports.js";
import type { RegisteredTool } from "../../application/tool-registry.js";
import { DomainError } from "../../domain/contracts.js";

export type ScheduledTaskRecord = { readonly id: string; readonly executeAt: Date; readonly instruction: string; readonly reason: string | null; readonly destination: string | null; readonly status: string; readonly attempt: number };
export interface ScheduledTaskToolRepository {
  create(input: { readonly id: string; readonly agentId: string; readonly executeAt: Date; readonly instruction: string; readonly reason?: string; readonly destination?: string; readonly idempotencyKey: string; readonly eventId: string; readonly runId: string }): Promise<ScheduledTaskRecord | undefined>;
  list(agentId: string, status: string | undefined, limit: number): Promise<readonly ScheduledTaskRecord[]>;
  cancel(agentId: string, taskId: string): Promise<ScheduledTaskRecord | undefined>;
  update(agentId: string, taskId: string, input: { readonly executeAt?: Date; readonly instruction?: string; readonly reason?: string; readonly destination?: string }): Promise<ScheduledTaskRecord | undefined>;
}

const result = (row: ScheduledTaskRecord) => ({ id: row.id, executeAt: row.executeAt.toISOString(), instruction: row.instruction, ...(row.reason === null ? {} : { reason: row.reason }), ...(row.destination === null ? {} : { destination: row.destination }), status: row.status, attempt: row.attempt });
const instructionDescription = "期限到来時に実行する仕事だけを1〜2文で書く。必要なら対象、参照する情報、期待する結果を含める。実行日時、予約理由、送信先、Toolの使い方、共通動作規則は書かない";
const CreateSchema = z.object({ executeAt: z.iso.datetime({ offset: true }).describe("実行する将来のISO 8601日時"), instruction: z.string().trim().min(1).max(1_000).describe(instructionDescription), reason: z.string().trim().min(1).max(1_000).optional().describe("この実行を予約する理由。期限到来時の作業手順は書かない"), destination: z.string().trim().min(1).max(1_000).optional().describe("結果の明示的な配送先。通常は省略する") }).strict();
const ListSchema = z.object({ status: z.enum(["scheduled", "running", "completed", "cancelled", "failed"]).optional().describe("指定した状態だけに絞る。全件なら省略する"), limit: z.number().int().min(1).max(50).default(20).describe("返す最大件数") }).strict();
const CancelSchema = z.object({ taskId: z.string().trim().min(1).describe("取り消すScheduled TaskのID") }).strict();
const UpdateSchema = z.object({
  taskId: z.string().trim().min(1).describe("変更するScheduled TaskのID"),
  executeAt: z.iso.datetime({ offset: true }).optional().describe("変更後の将来のISO 8601実行日時"),
  instruction: z.string().trim().min(1).max(1_000).optional().describe(instructionDescription),
  reason: z.string().trim().min(1).max(1_000).optional().describe("この実行を予約する理由。期限到来時の作業手順は書かない"),
  destination: z.string().trim().min(1).max(1_000).optional().describe("結果の明示的な配送先。通常は省略する")
}).strict().refine(({ executeAt, instruction, reason, destination }) => executeAt !== undefined || instruction !== undefined || reason !== undefined || destination !== undefined, { message: "At least one field to update is required" });

export function createScheduledTaskTools(repository: ScheduledTaskToolRepository, ids: IdGenerator, now: () => Date): readonly RegisteredTool[] {
  const create: RegisteredTool<z.infer<typeof CreateSchema>> = {
      name: "schedule_task", description: "指定した将来時刻に一度だけ実行する仕事を予約する。予約時には実行しない。", resultPolicy: { kind: "standard" },
      schema: CreateSchema,
      execute: async (input, context) => {
        if (context.eventId === undefined) throw new DomainError("VALIDATION", "schedule_task requires an Event context");
        const executeAt = new Date(input.executeAt); if (executeAt.getTime() <= now().getTime()) throw new DomainError("VALIDATION", "executeAt must be in the future");
        const row = await repository.create({ id: ids.next(), agentId: context.agentId, executeAt, instruction: input.instruction, ...(input.reason === undefined ? {} : { reason: input.reason }), ...(input.destination === undefined ? {} : { destination: input.destination }), idempotencyKey: context.idempotencyKey, eventId: context.eventId, runId: context.runId }); if (row === undefined) throw new DomainError("EXTERNAL", "Scheduled Task was not stored");
        return { ok: true, value: result(row) };
      }
    };
  const list: RegisteredTool<z.infer<typeof ListSchema>> = {
      name: "scheduled_task_list", description: "自分が所有するScheduled Taskを一覧する。", resultPolicy: { kind: "standard" },
      schema: ListSchema,
      execute: async (input, context) => {
        return { ok: true, value: { tasks: (await repository.list(context.agentId, input.status, input.limit)).map(result) } };
      }
    };
  const cancel: RegisteredTool<z.infer<typeof CancelSchema>> = {
      name: "scheduled_task_cancel", description: "自分が所有する未実行のScheduled Taskを取り消す。", resultPolicy: { kind: "standard" },
      schema: CancelSchema,
      execute: async (input, context) => {
        const row = await repository.cancel(context.agentId, input.taskId); if (row === undefined) throw new DomainError("NOT_FOUND", "Scheduled Task was not found or cannot be cancelled");
        return { ok: true, value: result(row) };
      }
    };
  const update: RegisteredTool<z.infer<typeof UpdateSchema>> = {
    name: "scheduled_task_update", description: "自分が所有する未実行のScheduled Taskの実行日時、指示、理由、送信先を変更する。", resultPolicy: { kind: "standard" },
    schema: UpdateSchema,
    execute: async (input, context) => {
      if (input.executeAt !== undefined && new Date(input.executeAt).getTime() <= now().getTime()) throw new DomainError("VALIDATION", "executeAt must be in the future");
      const row = await repository.update(context.agentId, input.taskId, { ...(input.executeAt === undefined ? {} : { executeAt: new Date(input.executeAt) }), ...(input.instruction === undefined ? {} : { instruction: input.instruction }), ...(input.reason === undefined ? {} : { reason: input.reason }), ...(input.destination === undefined ? {} : { destination: input.destination }) }); if (row === undefined) throw new DomainError("NOT_FOUND", "Scheduled Task was not found or cannot be updated");
      return { ok: true, value: result(row) };
    }
  };
  return [create, list, cancel, update];
}
