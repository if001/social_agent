import { AgentStatePatchService } from "../../src/application/agent-state-patch.js";
import type { CurrentAgentState } from "../../src/domain/contracts.js";

const state: CurrentAgentState = { agentId: "a", mood: "calm", concerns: [], relationships: [], updatedAt: "2026-01-01T00:00:00Z" };

describe("AgentStatePatchService", () => {
  it("applies mood, relationship, and memory intent together", () => {
    const result = new AgentStatePatchService().apply("a", state, {
      mood: "hurt but composed",
      relationship: { operation: "upsert", relationship: { subjectId: "user", description: "trust was damaged by a broken promise" } },
      remember: "The user broke an important promise."
    }, "event-1");
    expect(result.state).toMatchObject({ mood: "hurt but composed", concerns: [], relationships: [{ subjectId: "user" }] });
    expect(result.changes.map(({ target }) => target)).toEqual(["mood", "relationships"]);
    expect(result.remember).toBe("The user broke an important promise.");
  });

  it("removes owned relationships and rejects another agent", () => {
    const populated: CurrentAgentState = { ...state, concerns: [{ id: "done", description: "done", whyItMatters: "was important", status: "satisfied" }], relationships: [{ subjectId: "old", description: "old context" }] };
    const relationship = new AgentStatePatchService().apply("a", populated, { relationship: { operation: "remove", subjectId: "old" } }, "event-3");
    expect(relationship.state.concerns).toMatchObject([{ id: "done" }]);
    expect(relationship.state.relationships).toEqual([]);
    expect(() => new AgentStatePatchService().apply("b", state, undefined, "event-4")).toThrow("another agent");
  });

  it("commits deferred Concern proposals only when the runtime applies a successful result", () => {
    const service = new AgentStatePatchService();
    const populated: CurrentAgentState = { ...state, concerns: [{ id: "focus", description: "調査する", whyItMatters: "判断するため", status: "active" }] };
    const patched = service.apply("a", populated, undefined, "event-5");
    const committed = service.applyConcernProposals(patched, [{ operation: "derive", sourceConcernId: "focus", explorationMode: "deepen", transition: "replace", description: "検証方法を確認する", whyItMatters: "結果の信頼性を判断するため" }], "event-5", () => "successor");
    expect(committed.state.concerns).toMatchObject([{ id: "focus", status: "satisfied" }, { id: "successor", status: "active", description: "検証方法を確認する" }]);
    expect(committed.changes.at(-1)).toMatchObject({ target: "concerns", before: [{ id: "focus", status: "active" }] });
    expect(patched.state.concerns).toMatchObject([{ id: "focus", status: "active" }]);
  });
});
