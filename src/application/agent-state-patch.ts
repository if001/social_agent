import { DomainError, type ConcernActivityIntent, type CurrentAgentState, type ResolvedConcernProposal } from "../domain/contracts.js";
import { ConcernLifecycleService } from "./concern-lifecycle.js";

export type AgentStatePatchChange = {
  readonly target: "mood" | "concerns" | "relationships";
  readonly operation: "set" | "upsert" | "remove";
  readonly before: unknown;
  readonly after: unknown;
  readonly eventId: string;
};

export type AgentStatePatchResult = {
  readonly state: CurrentAgentState;
  readonly changes: readonly AgentStatePatchChange[];
  readonly concernActivities: readonly ConcernActivityIntent[];
};

export class AgentStatePatchService {
  readonly #lifecycle = new ConcernLifecycleService();
  initial(agentId: string, state: CurrentAgentState): AgentStatePatchResult {
    if (state.agentId !== agentId) throw new DomainError("VALIDATION", "Cannot update another agent's state");
    return { state, changes: [], concernActivities: [] };
  }

  applyConcernProposals(result: AgentStatePatchResult, proposals: readonly ResolvedConcernProposal[], eventId: string, nextId: () => string): AgentStatePatchResult {
    if (proposals.length === 0) return result;
    const before = result.state.concerns;
    const applied = this.#lifecycle.applyProposals(before, proposals, nextId);
    const concerns = applied.concerns;
    const activities: ConcernActivityIntent[] = applied.activities.map((activity) => activity.kind === "derived"
      ? { concernId: activity.concernId, kind: "derived", eventId, sourceConcernId: activity.sourceConcernId, reason: activity.derivationReason, evidenceMemoryIds: activity.evidenceMemoryIds }
      : { concernId: activity.concernId, kind: "created", eventId });
    if (concerns.length === before.length && concerns.every((value, index) => value === before[index])) return result;
    return {
      ...result,
      state: { ...result.state, concerns: [...concerns] },
      changes: [...result.changes, { target: "concerns", operation: "upsert", before, after: concerns, eventId }],
      concernActivities: [...result.concernActivities, ...activities]
    };
  }
}
