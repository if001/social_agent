import { StateUpdateService } from "../../src/application/state-update-service.js";
import type { DynamicState } from "../../src/domain/contracts.js";

const state: DynamicState = { agentId: "a", mood: "Steady", motives: [{ id: "motive-1", description: "Learn", sourceEvidenceIds: ["old-event"], since: "2026-01-01T00:00:00Z" }], motiveExploration: [], updatedAt: "2026-01-01T00:00:00Z" };

describe("StateUpdateService", () => {
  const service = new StateUpdateService();
  it("applies allowed persistent updates with trace evidence", () => {
    const result = service.apply("a", state, [{ target: "mood", operation: "set", value: "Encouraged", reason: "Positive response", evidenceIds: ["event-1"] }]);
    expect(result.state.mood).toBe("Encouraged");
    expect(result.changes[0]).toMatchObject({ target: "mood", before: "Steady", after: "Encouraged" });
  });
  it("persists the current Emotion with occurrence time and evidence Event", () => {
    const result = service.apply("a", state, [{ target: "emotion", operation: "set", value: "嬉しい", reason: "歓迎された", evidenceIds: ["event-1"] }], [], "2026-01-02T00:00:00Z", "event-1");
    expect(result.state.emotion).toEqual({ description: "嬉しい", occurredAt: "2026-01-02T00:00:00Z", evidenceEventId: "event-1" });
    expect(result.changes[0]).toMatchObject({ target: "emotion", before: undefined, after: result.state.emotion });
  });
  it("rejects removed and long-term targets", () => {
    expect(() => service.apply("a", state, [{ target: "desires", operation: "set", value: [], reason: "legacy", evidenceIds: [] }])).toThrow();
    expect(() => service.apply("a", state, [{ target: "identity", operation: "set", value: "Changed", reason: "No", evidenceIds: [] }])).toThrow();
  });
  it("rejects another agent", () => {
    expect(() => service.apply("b", state, [])).toThrow("another agent");
  });
});
