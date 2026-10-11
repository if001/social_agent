import { applyMotiveProposals, StateUpdateService } from "../../src/application/state-update-service.js";
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
  it("creates, updates, merges and resolves Motives", () => {
    const created = applyMotiveProposals(state, [{ operation: "create", description: "Help", reason: "Need", evidenceIds: ["event-new"] }], () => "motive-2", "2026-01-02T00:00:00Z");
    expect(created.state.motives[1]).toMatchObject({ id: "motive-2", description: "Help" });
    const updated = applyMotiveProposals(created.state, [{ operation: "update", motiveId: "motive-1", description: "Learn deeply", goal: "Explain it", progress: 50, reason: "Scope clarified", evidenceIds: ["event-2"] }], () => "unused", "2026-01-03T00:00:00Z");
    expect(updated.state.motives[0]).toMatchObject({ description: "Learn deeply", progress: 50, since: "2026-01-01T00:00:00Z" });
    const merged = applyMotiveProposals(updated.state, [{ operation: "merge", motiveIds: ["motive-1", "motive-2"], description: "Learn to help", reason: "Same aim", evidenceIds: ["memory-1"] }], () => "unused", "2026-01-04T00:00:00Z");
    expect(merged.state.motives).toHaveLength(1);
    expect(applyMotiveProposals(merged.state, [{ operation: "resolve", motiveId: "unused", reason: "Satisfied", evidenceIds: ["event-3"] }], () => "unused").state.motives).toEqual([]);
  });
  it("tracks repeated no-progress updates and cooldown", () => {
    const exploratory: DynamicState = { ...state, motives: [{ id: "motive-1", description: "Learn", sourceEvidenceIds: ["old-event"], since: "2026-01-01T00:00:00Z", goal: "Explain it", progress: 25 }], motiveExploration: [] };
    const first = applyMotiveProposals(exploratory, [{ operation: "update", motiveId: "motive-1", description: "Learn", goal: "Explain it", progress: 25, reason: "No progress", evidenceIds: ["event-1"] }], () => "unused", "2026-01-01T00:00:00Z");
    const second = applyMotiveProposals(first.state, [{ operation: "update", motiveId: "motive-1", description: "Learn", goal: "Explain it", progress: 25, reason: "No progress", evidenceIds: ["event-2"] }], () => "unused", "2026-01-01T01:00:00Z");
    expect(second.state.motiveExploration[0]).toMatchObject({ consecutiveNoProgress: 2, cooldownUntil: "2026-01-01T07:00:00.000Z" });
  });
  it("rejects unknown Motive references and another agent", () => {
    expect(() => applyMotiveProposals(state, [{ operation: "maintain", motiveId: "unknown", reason: "No", evidenceIds: ["event"] }], () => "unused")).toThrow("unknown Motive");
    expect(() => service.apply("b", state, [])).toThrow("another agent");
  });
});
