import { DomainError, type ConcernProposal, type CurrentAgentState } from "../domain/contracts.js";

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
};

export class AgentStatePatchService {
  initial(agentId: string, state: CurrentAgentState): AgentStatePatchResult {
    if (state.agentId !== agentId) throw new DomainError("VALIDATION", "Cannot update another agent's state");
    return { state, changes: [] };
  }

  applyConcernProposals(result: AgentStatePatchResult, proposals: readonly ConcernProposal[], eventId: string, nextId: () => string): AgentStatePatchResult {
    if (proposals.length === 0) return result;
    const before = result.state.concerns;
    let concerns = [...before];
    for (const proposal of proposals) {
      if (proposal.operation === "derive") {
        const source = concerns.find(({ id }) => id === proposal.sourceConcernId);
        if (source === undefined || source.status !== "active") continue;
        if (proposal.transition === "replace") concerns = concerns.map((concern) => concern.id === source.id ? { ...concern, status: "satisfied" as const } : concern);
      }
      concerns.push({ id: nextId(), description: proposal.description, whyItMatters: proposal.whyItMatters, status: "active", ...(proposal.reconsiderAt === undefined ? {} : { reconsiderAt: proposal.reconsiderAt }) });
    }
    if (concerns.length === before.length && concerns.every((value, index) => value === before[index])) return result;
    return {
      ...result,
      state: { ...result.state, concerns },
      changes: [...result.changes, { target: "concerns", operation: "upsert", before, after: concerns, eventId }]
    };
  }
}
