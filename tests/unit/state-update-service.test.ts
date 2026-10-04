import { StateUpdateService } from "../../src/application/state-update-service.js";
import type { DynamicState } from "../../src/domain/contracts.js";

const state: DynamicState = { agentId: "a", mood: "Steady", drives: [{ description: "Learn", sourceEvidenceIds: ["old-event"], since: "2026-01-01T00:00:00Z" }], currentInterests: [], updatedAt: "2026-01-01T00:00:00Z" };

describe("StateUpdateService", () => {
  const service = new StateUpdateService();
  it("applies allowed short-term updates with trace evidence", () => {
    const result = service.apply("a", state, [{ target: "mood", operation: "set", value: "Encouraged", reason: "Positive response", evidenceIds: ["event-1"] }]);
    expect(result.state.mood).toBe("Encouraged");
    expect(result.changes).toEqual([{ target: "mood", operation: "set", before: "Steady", after: "Encouraged", reason: "Positive response", evidenceIds: ["event-1"] }]);
    expect(state.mood).toBe("Steady");
  });
  it("updates multiple drives, desires and current interests", () => {
    const result = service.apply("a", state, [{ target: "drives", operation: "append", value: "Help", reason: "Need", evidenceIds: ["event-new"] }, { target: "desires", operation: "set", value: ["Listen", "Clarify"], reason: "Conversation", evidenceIds: [] }, { target: "currentInterests", operation: "append", value: "Memory design", reason: "Relevant", evidenceIds: [] }]);
    expect(result.state.drives).toEqual([{ description: "Learn", sourceEvidenceIds: ["old-event"], since: "2026-01-01T00:00:00Z" }, { description: "Help", sourceEvidenceIds: ["event-new"], since: "2026-01-01T00:00:00Z" }]);
    expect(result.state).not.toHaveProperty("desires");
    expect(result.changes.find(({ target }) => target === "desires")).toMatchObject({ before: [], after: ["Listen", "Clarify"] });
    expect(result.state.currentInterests).toEqual(["Memory design"]);
  });
  it("rejects long-term, invalid Social Context values, invalid operations and another agent", () => {
    expect(() => service.apply("a", state, [{ target: "identity", operation: "set", value: "Changed", reason: "No", evidenceIds: [] }])).toThrow();
    expect(() => service.apply("a", state, [{ target: "socialContext", operation: "set", value: { subjectId: "owner" }, reason: "No", evidenceIds: [] }])).toThrow("requires subjectType and description");
    expect(() => service.apply("a", state, [{ target: "mood", operation: "append", value: "Changed", reason: "No", evidenceIds: [] }])).toThrow("Invalid operation");
    expect(() => service.apply("b", state, [])).toThrow("another agent");
  });
  it("validates Working Social Context updates without changing dynamic state", () => {
    const result = service.apply("a", state, [{ target: "socialContext", operation: "set", value: { subjectId: "owner", subjectType: "user", description: "Trusted collaborator" }, reason: "Repeated interaction", evidenceIds: [] }]);
    expect(result.state).toEqual(state);
    expect(result.changes[0]).toMatchObject({ target: "socialContext", after: { subjectId: "owner", subjectType: "user", description: "Trusted collaborator" } });
  });
  it("does not return partial state when any proposal is invalid", () => {
    expect(() => service.apply("a", state, [{ target: "mood", operation: "set", value: "Happy", reason: "First", evidenceIds: [] }, { target: "identity", operation: "set", value: "Changed", reason: "Second", evidenceIds: [] }])).toThrow();
    expect(state.mood).toBe("Steady");
  });
});
