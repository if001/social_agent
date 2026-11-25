import type { Concern, ConcernActivityKind, ResolvedConcernProposal } from "../domain/contracts.js";

export type ConcernLifecycleActivity = { readonly concernId: string; readonly kind: ConcernActivityKind };
export type ConcernReconciliationChange =
  | { readonly operation: "remove"; readonly id: string }
  | { readonly operation: "create"; readonly concern: Omit<Concern, "id"> }
  | { readonly operation: "upsert"; readonly concern: Concern };

/**
 * Pure lifecycle transitions. Persistence supplies evidence, ownership,
 * transaction and idempotency; this service owns only valid state changes and
 * their required activity semantics.
 */
export class ConcernLifecycleService {
  focus(concernId: string): ConcernLifecycleActivity { return { concernId, kind: "focused" }; }
  progress(concernId: string): ConcernLifecycleActivity { return { concernId, kind: "progressed" }; }

  applyProposals(current: readonly Concern[], proposals: readonly ResolvedConcernProposal[], nextId: () => string): { readonly concerns: readonly Concern[]; readonly activities: readonly (ConcernLifecycleActivity & Pick<ResolvedConcernProposal, "sourceConcernId" | "derivationReason" | "evidenceMemoryIds">)[] } {
    const concerns = [...current];
    const activities: (ConcernLifecycleActivity & Pick<ResolvedConcernProposal, "sourceConcernId" | "derivationReason" | "evidenceMemoryIds">)[] = [];
    for (const proposal of proposals) {
      if (proposal.operation === "derive") {
        const source = concerns.find(({ id }) => id === proposal.sourceConcernId);
        if (source === undefined || source.status !== "active") continue;
      }
      const id = nextId();
      concerns.push({ id, description: proposal.description, whyItMatters: proposal.whyItMatters, status: "active" });
      activities.push(proposal.operation === "derive"
        ? { concernId: id, kind: "derived", sourceConcernId: proposal.sourceConcernId, derivationReason: proposal.derivationReason, evidenceMemoryIds: proposal.evidenceMemoryIds }
        : { concernId: id, kind: "created" });
    }
    return { concerns, activities };
  }

  reconcile(current: readonly Concern[], changes: readonly ConcernReconciliationChange[], nextId: () => string): { readonly concerns: readonly Concern[]; readonly activities: readonly ConcernLifecycleActivity[] } {
    const values = new Map(current.map((value) => [value.id, value]));
    const activities: ConcernLifecycleActivity[] = [];
    for (const change of changes) {
      if (change.operation === "remove") { values.delete(change.id); activities.push({ concernId: change.id, kind: "removed" }); continue; }
      if (change.operation === "create") { const id = nextId(); values.set(id, { ...change.concern, id }); activities.push({ concernId: id, kind: "created" }); continue; }
      const before = values.get(change.concern.id);
      values.set(change.concern.id, change.concern);
      activities.push({ concernId: change.concern.id, kind: "reviewed" });
      if (before !== undefined && before.status !== change.concern.status) activities.push({ concernId: change.concern.id, kind: "status-changed" });
    }
    return { concerns: [...values.values()], activities };
  }

  applyOutcome(current: readonly Concern[], concernId: string, outcome: "progress" | "satisfied" | "abandoned"): { readonly concerns: readonly Concern[]; readonly activity: ConcernLifecycleActivity } | undefined {
    const focus = current.find((concern) => concern.id === concernId && concern.status === "active");
    if (focus === undefined) return undefined;
    const status = outcome === "progress" ? focus.status : outcome;
    return { concerns: current.map((concern) => concern.id === focus.id ? { ...concern, status } : concern), activity: { concernId: focus.id, kind: outcome === "progress" ? "progressed" : "status-changed" } };
  }
}
