import { StateUpdateService } from "../../src/application/state-update-service.js";
import type { DynamicState } from "../../src/domain/contracts.js";

const state: DynamicState = { agentId: "a", emotion: "Calm", mood: "Steady", drive: "Learn", desire: "Listen", updatedAt: "2026-01-01T00:00:00Z" };

describe("StateUpdateService", () => {
  const service = new StateUpdateService();
  it("applies allowed short-term updates with trace evidence", () => {
    const result = service.apply("a", state, [{ target: "mood", operation: "set", value: "Encouraged", reason: "Positive response", evidenceIds: ["event-1"] }]);
    expect(result.state.mood).toBe("Encouraged");
    expect(result.changes).toEqual([{ target: "mood", operation: "set", before: "Steady", after: "Encouraged", reason: "Positive response", evidenceIds: ["event-1"] }]);
    expect(state.mood).toBe("Steady");
  });
  it("rejects long-term, social ownership, invalid operations and another agent", () => {
    expect(() => service.apply("a", state, [{ target: "identity", operation: "set", value: "Changed", reason: "No", evidenceIds: [] }])).toThrow();
    expect(() => service.apply("a", state, [{ target: "socialContext", operation: "set", value: "Changed", reason: "No", evidenceIds: [] }])).toThrow("owning service");
    expect(() => service.apply("a", state, [{ target: "mood", operation: "append", value: "Changed", reason: "No", evidenceIds: [] }])).toThrow("Invalid operation");
    expect(() => service.apply("b", state, [])).toThrow("another agent");
  });
  it("does not return partial state when any proposal is invalid", () => {
    expect(() => service.apply("a", state, [{ target: "mood", operation: "set", value: "Happy", reason: "First", evidenceIds: [] }, { target: "identity", operation: "set", value: "Changed", reason: "Second", evidenceIds: [] }])).toThrow();
    expect(state.mood).toBe("Steady");
  });
});
