import { and, eq, sql } from "drizzle-orm";
import { index, integer, jsonb, pgSchema, text, timestamp } from "drizzle-orm/pg-core";

import type { G3ModelResult, G3Task, G3TaskRepository } from "../../application/g3.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { agents, predictionRecords } from "./schema.js";

// The deployed G3 work-item table predates an unused `plan` column that is
// present only in an old Drizzle snapshot. Keep the runtime query shape exact
// and typed until the schema cutover Issue removes that historical drift.
const g3Tasks = pgSchema("app").table("g3_tasks", { id: text("id").primaryKey(), agentId: text("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }), sourcePredictionId: text("source_prediction_id").notNull(), sourceEventId: text("source_event_id").notNull(), sourceRunId: text("source_run_id"), status: text("status").notNull().default("pending"), attempt: integer("attempt").notNull().default(0), deadlineAt: timestamp("deadline_at", { withTimezone: true }), leaseUntil: timestamp("lease_until", { withTimezone: true }), input: jsonb("input").notNull(), output: jsonb("output"), failureReason: text("failure_reason"), createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(), completedAt: timestamp("completed_at", { withTimezone: true }) }, (table) => [index("g3_tasks_agent_status_idx").on(table.agentId, table.status, table.createdAt)]);

export class PostgresG3TaskRepository implements G3TaskRepository {
  constructor(private readonly database: RuntimeDatabase, private readonly agentId: string) {}

  async save(task: G3Task): Promise<void> {
    const prediction = (await this.database.db.select({
      agentId: predictionRecords.agentId,
      sourceEventId: predictionRecords.sourceEventId,
      sourceRunId: predictionRecords.sourceRunId
    }).from(predictionRecords).where(eq(predictionRecords.id, task.sourcePredictionId)).limit(1))[0];
    if (prediction === undefined || prediction.agentId !== task.agentId || prediction.sourceEventId !== task.sourceEventId || prediction.sourceRunId !== task.sourceRunId) throw new Error("G3 Task source Prediction does not match its Agent, Event and Run");
    await this.database.db.insert(g3Tasks).values({
      id: task.id, agentId: task.agentId, sourcePredictionId: task.sourcePredictionId,
      sourceEventId: task.sourceEventId, sourceRunId: task.sourceRunId,
      status: task.status, attempt: task.attempt, deadlineAt: new Date(task.deadlineAt),
      leaseUntil: task.leaseUntil === undefined ? null : new Date(task.leaseUntil),
      input: task.input, createdAt: new Date(task.createdAt)
    });
  }

  async claim(taskId: string, now: string, leaseUntil: string, maxAttempts: number): Promise<G3Task | undefined> {
    // PostgreSQL-native: one conditional UPDATE atomically claims a leased task.
    const result = await this.database.db.execute(sql<G3TaskRow>`UPDATE app.g3_tasks SET status=CASE WHEN output IS NULL THEN 'running' ELSE 'result-pending' END,attempt=attempt+1,lease_until=${leaseUntil},failure_reason=NULL WHERE id=${taskId} AND agent_id=${this.agentId} AND attempt<${maxAttempts} AND deadline_at>${now} AND source_run_id IS NOT NULL AND (status='pending' OR (status IN ('running','result-pending') AND lease_until<=${now})) RETURNING *`);
    return result.rows[0] === undefined ? undefined : mapTask(result.rows[0] as unknown as G3TaskRow);
  }

  async claimDue(now: string, leaseUntil: string, maxAttempts: number): Promise<G3Task | undefined> {
    await this.database.db.update(g3Tasks).set({
      status: "failed",
      failureReason: sql`CASE WHEN ${g3Tasks.sourceRunId} IS NULL THEN 'Legacy G3 task has no source Run' WHEN ${g3Tasks.attempt}>=${maxAttempts} THEN 'G3 task attempt limit exceeded' ELSE COALESCE(${g3Tasks.failureReason},'G3 task deadline exceeded') END`,
      completedAt: new Date(now), leaseUntil: null
    }).where(and(
      eq(g3Tasks.agentId, this.agentId),
      sql`${g3Tasks.status} IN ('pending','running','result-pending')`,
      sql`(${g3Tasks.sourceRunId} IS NULL OR COALESCE(${g3Tasks.deadlineAt},${g3Tasks.createdAt})<=${now} OR (${g3Tasks.attempt}>=${maxAttempts} AND (${g3Tasks.status}='pending' OR ${g3Tasks.leaseUntil}<=${now})))`
    ));
    // PostgreSQL-native: SKIP LOCKED is required for concurrent workers.
    const result = await this.database.db.execute(sql<G3TaskRow>`WITH due AS (SELECT id FROM app.g3_tasks WHERE agent_id=${this.agentId} AND source_run_id IS NOT NULL AND attempt<${maxAttempts} AND deadline_at>${now} AND (status='pending' OR (status IN ('running','result-pending') AND lease_until<=${now})) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE app.g3_tasks t SET status=CASE WHEN t.output IS NULL THEN 'running' ELSE 'result-pending' END,attempt=t.attempt+1,lease_until=${leaseUntil},failure_reason=NULL FROM due WHERE t.id=due.id RETURNING t.*`);
    return result.rows[0] === undefined ? undefined : mapTask(result.rows[0] as unknown as G3TaskRow);
  }

  async saveResult(taskId: string, leaseToken: string, result: G3ModelResult): Promise<boolean> {
    return (await this.database.db.update(g3Tasks).set({ status: "result-pending", output: result }).where(and(
      eq(g3Tasks.id, taskId), eq(g3Tasks.agentId, this.agentId),
      eq(g3Tasks.status, "running"), eq(g3Tasks.leaseUntil, new Date(leaseToken))
    )).returning({ id: g3Tasks.id })).length === 1;
  }
  async complete(taskId: string, leaseToken: string, result: G3ModelResult, completedAt: string): Promise<boolean> {
    return (await this.database.db.update(g3Tasks).set({
      status: "completed", output: result, completedAt: new Date(completedAt), leaseUntil: null
    }).where(and(
      eq(g3Tasks.id, taskId), eq(g3Tasks.agentId, this.agentId),
      eq(g3Tasks.status, "result-pending"), eq(g3Tasks.leaseUntil, new Date(leaseToken))
    )).returning({ id: g3Tasks.id })).length === 1;
  }
  async retryOrFail(taskId: string, leaseToken: string, reason: string, now: string, maxAttempts: number): Promise<void> {
    await this.database.db.update(g3Tasks).set({
      status: sql`CASE WHEN ${g3Tasks.attempt}>=${maxAttempts} OR ${g3Tasks.deadlineAt}<=${now} THEN 'failed' ELSE 'pending' END`,
      failureReason: reason,
      completedAt: sql`CASE WHEN ${g3Tasks.attempt}>=${maxAttempts} OR ${g3Tasks.deadlineAt}<=${now} THEN ${now}::timestamptz ELSE NULL END`,
      leaseUntil: null
    }).where(and(
      eq(g3Tasks.id, taskId), eq(g3Tasks.agentId, this.agentId),
      sql`${g3Tasks.status} IN ('running','result-pending')`,
      eq(g3Tasks.leaseUntil, new Date(leaseToken))
    ));
  }
}

type G3TaskRow = { id: string; agent_id: string; source_prediction_id: string; source_event_id: string; source_run_id: string; status: G3Task["status"]; attempt: number; deadline_at: Date; lease_until: Date | null; input: G3Task["input"]; output: G3ModelResult | null; created_at: Date; completed_at: Date | null };
const mapTask = (row: G3TaskRow): G3Task => ({ id: row.id, agentId: row.agent_id, sourcePredictionId: row.source_prediction_id, sourceEventId: row.source_event_id, sourceRunId: row.source_run_id, status: row.status, attempt: row.attempt, deadlineAt: new Date(row.deadline_at).toISOString(), ...(row.lease_until === null ? {} : { leaseUntil: new Date(row.lease_until).toISOString() }), input: row.input, ...(row.output === null ? {} : { output: row.output.output, toolEvidence: row.output.toolEvidence }), createdAt: new Date(row.created_at).toISOString(), ...(row.completed_at === null ? {} : { completedAt: new Date(row.completed_at).toISOString() }) });
