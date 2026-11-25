import { and, eq, sql } from "drizzle-orm";

import type { ConcernNormalizationRepository } from "../../application/concern-normalization.js";
import { ConcernLifecycleService } from "../../application/concern-lifecycle.js";
import { CurrentConcernDescriptionSchema, CurrentConcernImportanceSchema, DomainError, type Concern } from "../../domain/contracts.js";
import { agentStates, concernActivities } from "./schema.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { ConcernRepository } from "./concern-repository.js";

const concernLifecycle = new ConcernLifecycleService();

export class PostgresConcernNormalizationRepository implements ConcernNormalizationRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  async loadActive(agentId: string): Promise<{ readonly version: number; readonly concerns: readonly Concern[] }> {
    const row = (await this.database.db.select({ version: agentStates.version }).from(agentStates).where(eq(agentStates.agentId, agentId)).limit(1))[0];
    if (row === undefined) throw new DomainError("NOT_FOUND", `Agent state was not found: ${agentId}`);
    const concerns = (await new ConcernRepository(this.database.db).list(agentId)).filter(({ status }) => status === "active");
    return { version: row.version, concerns };
  }

  apply(request: Parameters<ConcernNormalizationRepository["apply"]>[0]): Promise<number> {
    return this.database.transaction(async (transaction) => {
      const row = (await transaction.select({ version: agentStates.version }).from(agentStates).where(eq(agentStates.agentId, request.agentId)).limit(1))[0];
      if (row === undefined) throw new DomainError("NOT_FOUND", `Agent state was not found: ${request.agentId}`);
      if (row.version !== request.expectedVersion) throw new DomainError("CONFLICT", "Agent state version conflict");
      const current = await new ConcernRepository(transaction).list(request.agentId);
      const changes = new Map(request.changes.map((change) => [change.concernId, {
        description: CurrentConcernDescriptionSchema.parse(change.description),
        whyItMatters: CurrentConcernImportanceSchema.parse(change.whyItMatters)
      }]));
      if (changes.size !== request.changes.length) throw new DomainError("VALIDATION", "Concern normalization contains duplicate targets");
      for (const concernId of changes.keys()) {
        const concern = current.find(({ id }) => id === concernId);
        if (concern === undefined || concern.status !== "active") throw new DomainError("CONFLICT", `Active Concern was not found: ${concernId}`);
      }
      const normalized = current.map((concern) => {
        const change = changes.get(concern.id);
        return change === undefined ? concern : { ...concern, ...change };
      });
      const applied = concernLifecycle.reconcile(current, normalized.flatMap((concern) => changes.has(concern.id) ? [{ operation: "upsert" as const, concern }] : []), () => { throw new Error("Concern normalization cannot create a Concern"); });
      const updated = (await transaction.update(agentStates).set({ version: sql`${agentStates.version}+1`, updatedAt: request.occurredAt }).where(and(eq(agentStates.agentId, request.agentId), eq(agentStates.version, request.expectedVersion))).returning({ version: agentStates.version }))[0];
      if (updated === undefined) throw new DomainError("CONFLICT", "Agent state version conflict");
      await new ConcernRepository(transaction).replace(request.agentId, applied.concerns, request.occurredAt);
      if (applied.activities.length > 0) await transaction.insert(concernActivities).values(applied.activities.map((activity, index) => ({
        id: `concern-normalization:${request.runId}:${String(index)}:${activity.concernId}`,
        concernId: activity.concernId,
        kind: activity.kind,
        evidenceMemoryIds: [],
        occurredAt: request.occurredAt
      })));
      return updated.version;
    });
  }
}
