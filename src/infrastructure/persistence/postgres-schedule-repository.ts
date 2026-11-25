import { and, asc, desc, eq, inArray, isNotNull, isNull, lte, or } from "drizzle-orm";

import type { ScheduleRepository, ScheduledTarget } from "../../application/scheduler.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { autonomousSchedules, concernReevaluationBatches, concernReevaluationBatchMemories, concerns, eventExperiences, memories, reflectionRuns, scheduledTasks } from "./schema.js";

type DueAutonomousRow = { id: string; agentId: string; kind: "idle" | "concern-formation" | "reflection"; reason: string };
type DueConcernBatchRow = { id: string; agentId: string; focusConcernId: string; description: string; whyItMatters: string; impactReason: string | null; sourceEventId: string | null };
type DueTaskRow = { id: string; agentId: string; instruction: string; reason: string | null; destination: string | null };

export class PostgresScheduleRepository implements ScheduleRepository {
  constructor(private readonly database: RuntimeDatabase, private readonly leaseMs = 60_000, private readonly agentId?: string, private readonly retryDelayMs = 300_000) {}

  async claimDue(now: Date, limit: number): Promise<readonly ScheduledTarget[]> {
    const leasedUntil = new Date(now.getTime() + this.leaseMs);
    return this.database.transaction(async (tx) => {
      const taskCandidates = await tx.select({
        id: scheduledTasks.id, agentId: scheduledTasks.agentId, instruction: scheduledTasks.instruction,
        reason: scheduledTasks.reason, destination: scheduledTasks.destination, attempt: scheduledTasks.attempt
      }).from(scheduledTasks).where(and(
        eq(scheduledTasks.status, "scheduled"), lte(scheduledTasks.executeAt, now),
        or(isNull(scheduledTasks.leaseUntil), lte(scheduledTasks.leaseUntil, now)),
        ...(this.agentId === undefined ? [] : [eq(scheduledTasks.agentId, this.agentId)])
      )).orderBy(asc(scheduledTasks.executeAt), asc(scheduledTasks.id)).limit(limit);
      const taskRows: DueTaskRow[] = [];
      for (const candidate of taskCandidates) {
        const [claimed] = await tx.update(scheduledTasks).set({
          status: "running", leaseUntil: leasedUntil, attempt: candidate.attempt + 1, updatedAt: now
        }).where(and(
          eq(scheduledTasks.id, candidate.id), eq(scheduledTasks.status, "scheduled"), lte(scheduledTasks.executeAt, now),
          or(isNull(scheduledTasks.leaseUntil), lte(scheduledTasks.leaseUntil, now))
        )).returning({ id: scheduledTasks.id });
        if (claimed !== undefined) taskRows.push(candidate);
      }
      const remaining = Math.max(0, limit - taskRows.length);
      let autonomousRows: DueAutonomousRow[] = [];
      if (remaining > 0) {
        const candidates = await tx.select({ id: autonomousSchedules.id, agentId: autonomousSchedules.agentId, kind: autonomousSchedules.kind, reason: autonomousSchedules.reason })
          .from(autonomousSchedules).where(and(
            inArray(autonomousSchedules.kind, ["idle", "concern-formation", "reflection"]), lte(autonomousSchedules.nextDueAt, now),
            or(isNull(autonomousSchedules.leaseUntil), lte(autonomousSchedules.leaseUntil, now)),
            ...(this.agentId === undefined ? [] : [eq(autonomousSchedules.agentId, this.agentId)])
          )).orderBy(asc(autonomousSchedules.nextDueAt), asc(autonomousSchedules.id)).limit(remaining);
        for (const candidate of candidates) {
          const [claimed] = await tx.update(autonomousSchedules).set({ leaseUntil: leasedUntil, updatedAt: now }).where(and(
            eq(autonomousSchedules.id, candidate.id), lte(autonomousSchedules.nextDueAt, now),
            or(isNull(autonomousSchedules.leaseUntil), lte(autonomousSchedules.leaseUntil, now))
          )).returning({ id: autonomousSchedules.id });
          if (claimed !== undefined) autonomousRows.push({ ...candidate, kind: candidate.kind as DueAutonomousRow["kind"] });
        }
      }
      const signalRemaining = Math.max(0, remaining - autonomousRows.length);
      let signalRows: DueConcernBatchRow[] = [];
      if (signalRemaining > 0) {
        const candidates = await tx.select({
          id: concernReevaluationBatches.id, agentId: concernReevaluationBatches.agentId, focusConcernId: concernReevaluationBatches.focusConcernId,
          description: concerns.description, whyItMatters: concerns.whyItMatters, impactReason: concernReevaluationBatches.impactReason,
          sourceEventId: concernReevaluationBatches.sourceEventId
        }).from(concernReevaluationBatches).innerJoin(concerns, eq(concerns.id, concernReevaluationBatches.focusConcernId)).where(and(
          eq(concernReevaluationBatches.status, "pending"), lte(concernReevaluationBatches.nextDueAt, now), isNotNull(concernReevaluationBatches.focusConcernId),
          or(isNull(concernReevaluationBatches.leaseUntil), lte(concernReevaluationBatches.leaseUntil, now)),
          ...(this.agentId === undefined ? [] : [eq(concernReevaluationBatches.agentId, this.agentId)])
        )).orderBy(asc(concernReevaluationBatches.agentId), asc(concernReevaluationBatches.nextDueAt), asc(concernReevaluationBatches.id)).limit(signalRemaining * 8);
        const claimedFocuses = new Set<string>();
        for (const candidate of candidates) {
          if (candidate.focusConcernId === null) continue;
          const focusKey = `${candidate.agentId}:${candidate.focusConcernId}`;
          if (claimedFocuses.has(focusKey) || claimedFocuses.size >= signalRemaining) continue;
          const claimed = await tx.update(concernReevaluationBatches).set({ status: "claimed", leaseUntil: leasedUntil, claimedAt: now, updatedAt: now }).where(and(
            eq(concernReevaluationBatches.agentId, candidate.agentId), eq(concernReevaluationBatches.focusConcernId, candidate.focusConcernId),
            eq(concernReevaluationBatches.status, "pending"), lte(concernReevaluationBatches.nextDueAt, now),
            or(isNull(concernReevaluationBatches.leaseUntil), lte(concernReevaluationBatches.leaseUntil, now))
          )).returning({ id: concernReevaluationBatches.id });
          if (claimed.length === 0) continue;
          claimedFocuses.add(focusKey);
          const claimedIds = new Set(claimed.map(({ id }) => id));
          const rows = await tx.select({
            id: concernReevaluationBatches.id, agentId: concernReevaluationBatches.agentId, focusConcernId: concernReevaluationBatches.focusConcernId,
            description: concerns.description, whyItMatters: concerns.whyItMatters, impactReason: concernReevaluationBatches.impactReason,
            sourceEventId: concernReevaluationBatches.sourceEventId
          }).from(concernReevaluationBatches).innerJoin(concerns, eq(concerns.id, concernReevaluationBatches.focusConcernId))
            .where(inArray(concernReevaluationBatches.id, [...claimedIds])).orderBy(asc(concernReevaluationBatches.nextDueAt), asc(concernReevaluationBatches.id));
          signalRows.push(...rows.filter((row): row is DueConcernBatchRow => row.focusConcernId !== null));
        }
      }
      const groupedSignals = [...signalRows.reduce((groups, row) => { const key = `${row.agentId}:${row.focusConcernId}`; const values = groups.get(key) ?? []; values.push(row); groups.set(key, values); return groups; }, new Map<string, DueConcernBatchRow[]>()).values()];
      const signalTargets = await Promise.all(groupedSignals.map(async (rows): Promise<ScheduledTarget | undefined> => {
        const first = rows[0]; if (first === undefined) return undefined;
        const batchIds = rows.map(({ id }) => id);
        const memoryRows = await tx.select({ id: memories.id, content: memories.content }).from(concernReevaluationBatchMemories)
          .innerJoin(memories, eq(memories.id, concernReevaluationBatchMemories.memoryId))
          .where(inArray(concernReevaluationBatchMemories.batchId, batchIds)).orderBy(desc(memories.updatedAt), desc(memories.id)).limit(16);
        const sourceEventIds = rows.flatMap((row) => row.sourceEventId === null ? [] : [row.sourceEventId]);
        const experienceRows = sourceEventIds.length === 0 ? [] : await tx.select({ summary: eventExperiences.summary })
          .from(eventExperiences).where(inArray(eventExperiences.eventId, sourceEventIds)).limit(8);
        const experienceSummaries = experienceRows.length > 0 ? experienceRows.map(({ summary }) => summary) : memoryRows.map(({ content }) => content.slice(0, 400));
        return { id: `concern-due:${first.agentId}:${first.focusConcernId}`, agentId: first.agentId, kind: "concern-due", reason: first.impactReason ?? "新しい経験がConcernの派生を促した", batchIds, focusConcernId: first.focusConcernId, focusConcern: { description: first.description, whyItMatters: first.whyItMatters }, evidenceMemoryIds: memoryRows.map(({ id }) => id), experienceSummaries };
      }));
      return [
        ...taskRows.map((row): ScheduledTarget => ({ id: row.id, agentId: row.agentId, kind: "scheduled-task", reason: row.reason ?? "Scheduled Taskの期限到来", instruction: row.instruction, ...(row.destination === null ? {} : { destination: row.destination }) })),
        ...autonomousRows.map((row): ScheduledTarget => ({ id: row.id, agentId: row.agentId, kind: row.kind, reason: row.reason })),
        ...signalTargets.flatMap((target): ScheduledTarget[] => target === undefined ? [] : [target])
      ];
    });
  }

  async complete(target: ScheduledTarget, nextReviewAt: Date | null, executionEventId?: string): Promise<void> {
    if (target.kind === "scheduled-task") {
      await this.database.db.update(scheduledTasks).set({
        status: "completed", leaseUntil: null, failureReason: null,
        executionEventId: executionEventId ?? null, updatedAt: new Date()
      }).where(and(eq(scheduledTasks.id, target.id), eq(scheduledTasks.agentId, target.agentId)));
      return;
    }
    if (target.kind === "concern-due") {
      await this.database.db.update(concernReevaluationBatches).set({ status: "consumed", consumedAt: new Date(), leaseUntil: null, updatedAt: new Date() }).where(inArray(concernReevaluationBatches.id, [...target.batchIds]));
      return;
    }
    await this.database.db.update(autonomousSchedules).set({
      leaseUntil: null, nextDueAt: nextReviewAt ?? new Date(Date.now() + 86_400_000), updatedAt: new Date()
    }).where(eq(autonomousSchedules.id, target.id));
  }

  async release(target: ScheduledTarget): Promise<void> {
    if (target.kind === "scheduled-task") {
      const [task] = await this.database.db.select({ attempt: scheduledTasks.attempt, executeAt: scheduledTasks.executeAt }).from(scheduledTasks).where(and(eq(scheduledTasks.id, target.id), eq(scheduledTasks.agentId, target.agentId))).limit(1);
      if (task === undefined) return;
      const failed = task.attempt >= 3;
      await this.database.db.update(scheduledTasks).set({
        status: failed ? "failed" : "scheduled",
        executeAt: failed ? task.executeAt : new Date(Date.now() + this.retryDelayMs),
        leaseUntil: null, failureReason: "Scheduled Task execution failed", updatedAt: new Date()
      }).where(and(eq(scheduledTasks.id, target.id), eq(scheduledTasks.agentId, target.agentId)));
      return;
    }
    if (target.kind === "concern-due") {
      await this.database.db.update(concernReevaluationBatches).set({ status: "pending", leaseUntil: null, nextDueAt: new Date(Date.now() + this.retryDelayMs), updatedAt: new Date() }).where(inArray(concernReevaluationBatches.id, [...target.batchIds]));
      return;
    }
    if (target.kind === "reflection") {
      await this.database.transaction(async (tx) => {
        const retry = (await tx.select({ id: reflectionRuns.id, retryCount: reflectionRuns.retryCount }).from(reflectionRuns).where(and(
          eq(reflectionRuns.agentId, target.agentId),
          or(eq(reflectionRuns.status, "failed"), and(eq(reflectionRuns.status, "pending"), eq(reflectionRuns.failureReason, "Reflection has retryable target failures")))
        )).orderBy(desc(reflectionRuns.updatedAt), desc(reflectionRuns.id)).limit(1))[0];
        if (retry !== undefined) await tx.update(reflectionRuns).set({
          retryCount: retry.retryCount + 1, updatedAt: new Date()
        }).where(eq(reflectionRuns.id, retry.id));
        // Debug configuration intentionally retries immediately.  Use one
        // timestamp for both fields so an immediate retry is never negative.
        const retryAt = new Date();
        await tx.update(autonomousSchedules).set({ leaseUntil: null, nextDueAt: retryAt, updatedAt: retryAt })
          .where(eq(autonomousSchedules.id, target.id));
      });
      return;
    }
    await this.database.db.update(autonomousSchedules).set({
      leaseUntil: null, nextDueAt: new Date(Date.now() + this.retryDelayMs), updatedAt: new Date()
    }).where(eq(autonomousSchedules.id, target.id));
  }
}
