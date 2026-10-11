import { AgentStatePatchService } from "../../src/application/agent-state-patch.js";
import type { CurrentAgentState } from "../../src/domain/contracts.js";

const state: CurrentAgentState = { agentId: "a", mood: "calm", concerns: [], relationships: [], updatedAt: "2026-01-01T00:00:00Z" };

describe("AgentStatePatchService", () => {
  it("applies mood, concern, relationship, and memory intent together", () => {
    const result = new AgentStatePatchService().apply("a", state, {
      mood: "hurt but composed",
      concern: { operation: "upsert", concern: { id: "trust", description: "repair trust", whyItMatters: "the relationship matters", status: "active", reconsiderAt: "2026-01-02T00:00:00Z" } },
      relationship: { operation: "upsert", relationship: { subjectId: "user", description: "trust was damaged by a broken promise" } },
      remember: "The user broke an important promise."
    }, "event-1");
    expect(result.state).toMatchObject({ mood: "hurt but composed", concerns: [{ id: "trust" }], relationships: [{ subjectId: "user" }] });
    expect(result.changes.map(({ target }) => target)).toEqual(["mood", "concerns", "relationships"]);
    expect(result.remember).toBe("The user broke an important promise.");
  });

  it("removes owned entries and rejects another agent", () => {
    const populated: CurrentAgentState = { ...state, concerns: [{ id: "done", description: "done", whyItMatters: "was important", status: "satisfied" }], relationships: [{ subjectId: "old", description: "old context" }] };
    const concern = new AgentStatePatchService().apply("a", populated, { concern: { operation: "remove", id: "done" } }, "event-2");
    const relationship = new AgentStatePatchService().apply("a", concern.state, { relationship: { operation: "remove", subjectId: "old" } }, "event-3");
    expect(relationship.state.concerns).toEqual([]);
    expect(relationship.state.relationships).toEqual([]);
    expect(() => new AgentStatePatchService().apply("b", state, undefined, "event-4")).toThrow("another agent");
  });
});
