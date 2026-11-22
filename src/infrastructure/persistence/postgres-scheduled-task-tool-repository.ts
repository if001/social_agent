import { and, desc, eq } from "drizzle-orm";

import type { ScheduledTaskRecord, ScheduledTaskToolRepository } from "../tools/scheduled-task-tools.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { scheduledTasks } from "./schema.js";

type Row = typeof scheduledTasks.$inferSelect;
const record = (row: Row): ScheduledTaskRecord => ({
  id: row.id, executeAt: row.executeAt, instruction: row.instruction,
  reason: row.reason, destination: row.destination, status: row.status, attempt: row.attempt
});

/** PostgreSQL adapter; Tool definitions only depend on ScheduledTaskToolRepository. */
export class PostgresScheduledTaskToolRepository implements ScheduledTaskToolRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  async create(input: Parameters<ScheduledTaskToolRepository["create"]>[0]): Promise<ScheduledTaskRecord | undefined> {
    const rows = await this.database.db.insert(scheduledTasks).values({
      id: input.id, agentId: input.agentId, executeAt: input.executeAt,
      instruction: input.instruction, reason: input.reason,
      destination: input.destination ?? null, idempotencyKey: input.idempotencyKey,
      sourceEventId: input.eventId, sourceRunId: input.runId
    }).onConflictDoNothing({
      target: [scheduledTasks.agentId, scheduledTasks.idempotencyKey]
    }).returning();
    if (rows[0] !== undefined) return record(rows[0]);
    const existing = await this.database.db.select().from(scheduledTasks).where(and(
      eq(scheduledTasks.agentId, input.agentId),
      eq(scheduledTasks.idempotencyKey, input.idempotencyKey)
    )).limit(1);
    return existing[0] === undefined ? undefined : record(existing[0]);
  }

  async list(agentId: string, status: string | undefined, limit: number): Promise<readonly ScheduledTaskRecord[]> {
    const condition = status === undefined
      ? eq(scheduledTasks.agentId, agentId)
      : and(eq(scheduledTasks.agentId, agentId), eq(scheduledTasks.status, status));
    return (await this.database.db.select().from(scheduledTasks).where(condition)
      .orderBy(desc(scheduledTasks.executeAt), scheduledTasks.id).limit(limit)).map(record);
  }

  async cancel(agentId: string, taskId: string): Promise<ScheduledTaskRecord | undefined> {
    const rows = await this.database.db.update(scheduledTasks).set({
      status: "cancelled", leaseUntil: null, updatedAt: new Date()
    }).where(and(
      eq(scheduledTasks.id, taskId), eq(scheduledTasks.agentId, agentId),
      eq(scheduledTasks.status, "scheduled")
    )).returning();
    return rows[0] === undefined ? undefined : record(rows[0]);
  }

  async update(agentId: string, taskId: string, input: Parameters<ScheduledTaskToolRepository["update"]>[2]): Promise<ScheduledTaskRecord | undefined> {
    const values: Partial<typeof scheduledTasks.$inferInsert> = { updatedAt: new Date() };
    if (input.executeAt !== undefined) values.executeAt = input.executeAt;
    if (input.instruction !== undefined) values.instruction = input.instruction;
    if (input.reason !== undefined) values.reason = input.reason;
    if (input.destination !== undefined) values.destination = input.destination;
    const rows = await this.database.db.update(scheduledTasks).set(values).where(and(
      eq(scheduledTasks.id, taskId), eq(scheduledTasks.agentId, agentId),
      eq(scheduledTasks.status, "scheduled")
    )).returning();
    return rows[0] === undefined ? undefined : record(rows[0]);
  }
}
