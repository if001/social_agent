import { applyCurrentInterestProposals, applyDriveProposals, StateUpdateService } from "../../src/application/state-update-service.js";
import type { DynamicState } from "../../src/domain/contracts.js";

const state: DynamicState = { agentId: "a", mood: "Steady", drives: [{ description: "Learn", sourceEvidenceIds: ["old-event"], since: "2026-01-01T00:00:00Z" }], currentInterests: [], interestExploration: [], updatedAt: "2026-01-01T00:00:00Z" };

describe("StateUpdateService", () => {
  const service = new StateUpdateService();
  it("applies allowed short-term updates with trace evidence", () => {
    const result = service.apply("a", state, [{ target: "mood", operation: "set", value: "Encouraged", reason: "Positive response", evidenceIds: ["event-1"] }]);
    expect(result.state.mood).toBe("Encouraged");
    expect(result.changes).toEqual([{ target: "mood", operation: "set", before: "Steady", after: "Encouraged", reason: "Positive response", evidenceIds: ["event-1"] }]);
    expect(state.mood).toBe("Steady");
  });
  it("updates multiple drives and desires", () => {
    const result = service.apply("a", state, [{ target: "drives", operation: "append", value: "Help", reason: "Need", evidenceIds: ["event-new"] }, { target: "desires", operation: "set", value: ["Listen", "Clarify"], reason: "Conversation", evidenceIds: [] }]);
    expect(result.state.drives).toEqual([{ description: "Learn", sourceEvidenceIds: ["old-event"], since: "2026-01-01T00:00:00Z" }, { description: "Help", sourceEvidenceIds: ["event-new"], since: "2026-01-01T00:00:00Z" }]);
    expect(result.state).not.toHaveProperty("desires");
    expect(result.changes.find(({ target }) => target === "desires")).toMatchObject({ before: [], after: ["Listen", "Clarify"] });
  });
  it("creates and progresses Current Interest with runtime metadata", () => {
    const created = applyCurrentInterestProposals(state, [{ operation: "create", question: "Memory設計の何が未解決か", goal: "選択肢を説明できる", progress: 25, reason: "問いが具体化した", evidenceIds: ["event-new"] }], () => "interest-1");
    const progressed = applyCurrentInterestProposals(created.state, [{ operation: "progress", interestId: "interest-1", progress: 50, reason: "比較できた", evidenceIds: ["event-new"] }], () => "unused");
    expect(progressed.state.currentInterests[0]).toMatchObject({ id: "interest-1", progress: 50 });
    expect(progressed.state.interestExploration[0]).toMatchObject({ consecutiveNoProgress: 0 });
  });
  it("cools down a Current Interest after two no-progress explorations", () => {
    const active = { ...state, currentInterests: [{ id: "interest-1", question: "未知は何か", goal: "説明できる", progress: 25 as const }], interestExploration: [] };
    const first = applyCurrentInterestProposals(active, [{ operation: "progress", interestId: "interest-1", progress: 25, reason: "新情報なし", evidenceIds: ["event-1"] }], () => "unused", "2026-01-01T00:00:00Z");
    const second = applyCurrentInterestProposals(first.state, [{ operation: "progress", interestId: "interest-1", progress: 25, reason: "再び新情報なし", evidenceIds: ["event-2"] }], () => "unused", "2026-01-01T01:00:00Z");
    expect(second.state.interestExploration[0]).toMatchObject({ consecutiveNoProgress: 2, cooldownUntil: "2026-01-01T07:00:00.000Z" });
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

  it("creates, maintains, updates, merges, and ends grounded Drives while preserving since", () => {
    const created = applyDriveProposals(state, [{ operation: "create", description: "Help", reason: "A continuing need", evidenceIds: ["event-new"] }], "2026-01-02T00:00:00Z");
    expect(created.state.drives[1]).toMatchObject({ description: "Help", since: "2026-01-02T00:00:00Z" });
    const maintained = applyDriveProposals(created.state, [{ operation: "maintain", driveDescription: "Learn", reason: "Still unresolved", evidenceIds: ["event-2"] }], "2026-01-03T00:00:00Z");
    expect(maintained.state.drives[0]?.since).toBe("2026-01-01T00:00:00Z");
    const updated = applyDriveProposals(maintained.state, [{ operation: "update", driveDescription: "Learn", description: "Learn deeply", reason: "Scope clarified", evidenceIds: ["event-3"] }], "2026-01-04T00:00:00Z");
    expect(updated.state.drives.find(({ description }) => description === "Learn deeply")?.since).toBe("2026-01-01T00:00:00Z");
    const merged = applyDriveProposals(updated.state, [{ operation: "merge", driveDescriptions: ["Learn deeply", "Help"], description: "Learn to help", reason: "Same value", evidenceIds: ["memory-1"] }], "2026-01-05T00:00:00Z");
    expect(merged.state.drives).toEqual([{ description: "Learn to help", since: "2026-01-01T00:00:00Z", sourceEvidenceIds: ["old-event", "event-3", "event-new", "memory-1"] }]);
    expect(applyDriveProposals(merged.state, [{ operation: "end", driveDescription: "Learn to help", reason: "Resolved", evidenceIds: ["event-4"] }]).state.drives).toEqual([]);
  });

  it("rejects unknown Drive references", () => {
    expect(() => applyDriveProposals(state, [{ operation: "maintain", driveDescription: "Unknown", reason: "No source", evidenceIds: ["event"] }])).toThrow("unknown Drive");
  });
});
