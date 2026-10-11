import { DomainError, type AgentTurn, type CurrentAgentState } from "../domain/contracts.js";

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
    let concerns = [...state.concerns];
    let relationships = [...state.relationships];
    const changes: AgentStatePatchChange[] = [];
    if (patch.mood !== undefined && patch.mood !== mood) {
      changes.push({ target: "mood", operation: "set", before: mood, after: patch.mood, eventId });
      mood = patch.mood;
    }
    const concernChange = patch.concern;
    if (concernChange !== undefined) {
      const before = concerns;
      if (concernChange.operation === "remove") concerns = concerns.filter(({ id }) => id !== concernChange.id);
      else concerns = [...concerns.filter(({ id }) => id !== concernChange.concern.id), concernChange.concern];
      changes.push({ target: "concerns", operation: concernChange.operation, before, after: concerns, eventId });
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
}
