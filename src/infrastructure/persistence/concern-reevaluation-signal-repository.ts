import { eq, sql } from "drizzle-orm";

import { concernReevaluationSignals, concernReevaluationSignalSources } from "./schema.js";
import type { RuntimeDatabase } from "./runtime-database.js";

type SignalClient = RuntimeDatabase["db"] | Parameters<Parameters<RuntimeDatabase["transaction"]>[0]>[0];

export type ConcernReevaluationSignalSource = {
  readonly kind: "memory";
  readonly id: string;
};

/**
 * Coalesces meaningful new experience into one pending re-evaluation per
 * Agent.  Source rows are retained until a scheduler claim completes, so the
 * later concern-due loop can retrieve the actual evidence rather than treat a
 * clock as its motive.
 */
export async function enqueueConcernReevaluationSignal(
  client: SignalClient,
  input: { readonly agentId: string; readonly reason: string; readonly sources: readonly ConcernReevaluationSignalSource[]; readonly now: Date }
): Promise<void> {
  if (input.sources.length === 0) return;
  await client.insert(concernReevaluationSignals).values({
    agentId: input.agentId,
    nextDueAt: input.now,
    reason: input.reason,
    updatedAt: input.now
  }).onConflictDoUpdate({
    target: concernReevaluationSignals.agentId,
    set: {
      nextDueAt: sql`least(${concernReevaluationSignals.nextDueAt}, excluded.next_due_at)`,
      reason: input.reason,
      updatedAt: input.now
    }
  });
  await client.insert(concernReevaluationSignalSources).values(
    input.sources.map((source) => ({ agentId: input.agentId, sourceKind: source.kind, sourceId: source.id }))
  ).onConflictDoNothing();
}

export async function releaseConcernReevaluationSignal(client: SignalClient, agentId: string, nextDueAt: Date): Promise<void> {
  await client.update(concernReevaluationSignals).set({ leaseUntil: null, nextDueAt, updatedAt: new Date() })
    .where(eq(concernReevaluationSignals.agentId, agentId));
}
