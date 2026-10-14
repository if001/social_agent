import { DomainError, type AgentTurn, type ConcernProposal, type CurrentAgentState } from "../domain/contracts.js";

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
  readonly remember?: string;
};

export class AgentStatePatchService {
  apply(agentId: string, state: CurrentAgentState, patch: AgentTurn["patch"], eventId: string): AgentStatePatchResult {
    if (state.agentId !== agentId) throw new DomainError("VALIDATION", "Cannot update another agent's state");
    if (patch === undefined) return { state, changes: [] };
    let mood = state.mood;
    const concerns = [...state.concerns];
    let relationships = [...state.relationships];
    const changes: AgentStatePatchChange[] = [];
    if (patch.mood !== undefined && patch.mood !== mood) {
      changes.push({ target: "mood", operation: "set", before: mood, after: patch.mood, eventId });
      mood = patch.mood;
    }
    const relationshipChange = patch.relationship;
    if (relationshipChange !== undefined) {
      const before = relationships;
      if (relationshipChange.operation === "remove") relationships = relationships.filter(({ subjectId }) => subjectId !== relationshipChange.subjectId);
      else relationships = [...relationships.filter(({ subjectId }) => subjectId !== relationshipChange.relationship.subjectId), relationshipChange.relationship];
      changes.push({ target: "relationships", operation: relationshipChange.operation, before, after: relationships, eventId });
    }
    return {
      state: { ...state, ...(mood === undefined ? {} : { mood }), concerns, relationships },
      changes,
      ...(patch.remember === undefined ? {} : { remember: patch.remember })
    };
  }

  applyConcernProposals(result: AgentStatePatchResult, proposals: readonly ConcernProposal[], eventId: string, nextId: () => string): AgentStatePatchResult {
    if (proposals.length === 0) return result;
    const before = result.state.concerns;
    let concerns = [...before];
    for (const proposal of proposals) {
      if (proposal.operation === "derive") {
        const source = concerns.find(({ id }) => id === proposal.sourceConcernId);
        if (source === undefined || source.status !== "active") continue;
        if ((proposal.transition ?? "replace") === "replace") concerns = concerns.map((concern) => concern.id === source.id ? { ...concern, status: "satisfied" as const } : concern);
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
