import { DomainError, type ConcernActivityIntent, type ConcernProposal, type CurrentAgentState } from "../domain/contracts.js";

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
  initial(agentId: string, state: CurrentAgentState): AgentStatePatchResult {
    if (state.agentId !== agentId) throw new DomainError("VALIDATION", "Cannot update another agent's state");
    return { state, changes: [], concernActivities: [] };
  }

  applyConcernProposals(result: AgentStatePatchResult, proposals: readonly ConcernProposal[], eventId: string, nextId: () => string): AgentStatePatchResult {
    if (proposals.length === 0) return result;
    const before = result.state.concerns;
    let concerns = [...before];
    const activities: ConcernActivityIntent[] = [];
    for (const proposal of proposals) {
      if (proposal.operation === "derive") {
        const source = concerns.find(({ id }) => id === proposal.sourceConcernId);
        if (source === undefined || source.status !== "active") continue;
        if (proposal.transition === "replace") {
          concerns = concerns.map((concern) => concern.id === source.id ? { ...concern, status: "satisfied" as const } : concern);
          activities.push({ concernId: source.id, kind: "status-changed", eventId });
        }
      }
      const id = nextId();
      concerns.push({ id, description: proposal.description, whyItMatters: proposal.whyItMatters, status: "active", ...(proposal.reconsiderAt === undefined ? {} : { reconsiderAt: proposal.reconsiderAt }) });
      activities.push({ concernId: id, kind: proposal.operation === "derive" ? "derived" : "created", eventId });
    }
    if (concerns.length === before.length && concerns.every((value, index) => value === before[index])) return result;
    return {
      ...result,
      state: { ...result.state, concerns },
      changes: [...result.changes, { target: "concerns", operation: "upsert", before, after: concerns, eventId }],
      concernActivities: [...result.concernActivities, ...activities]
    };
  }
}
