import { AgentStatePatchService } from "../../src/application/agent-state-patch.js";
import type { CurrentAgentState } from "../../src/domain/contracts.js";

const state: CurrentAgentState = { agentId: "a", mood: "calm", concerns: [], relationships: [], updatedAt: "2026-01-01T00:00:00Z" };

describe("AgentStatePatchService", () => {
  it("FR-23: keeps ordinary persistent fields untouched until Experience Integration", () => {
    const result = new AgentStatePatchService().initial("a", state);
    expect(result).toEqual({ state, changes: [], concernActivities: [] });
  });

  it("FR-23, NFR-1: removes owned relationships and rejects another agent", () => {
    const populated: CurrentAgentState = { ...state, concerns: [{ id: "done", description: "done", whyItMatters: "was important", status: "satisfied" }], relationships: [{ subjectId: "old", description: "old context" }] };
    const initial = new AgentStatePatchService().initial("a", populated);
    expect(initial.state.relationships).toEqual([{ subjectId: "old", description: "old context" }]);
    expect(() => new AgentStatePatchService().initial("b", state)).toThrow("another agent");
  });

  it("FR-24: commits deferred Concern proposals only when the runtime applies a successful result", () => {
    const service = new AgentStatePatchService();
    const populated: CurrentAgentState = { ...state, concerns: [{ id: "focus", description: "調査する", whyItMatters: "判断するため", status: "active" }] };
    const patched = service.initial("a", populated);
    const committed = service.applyConcernProposals(patched, [{ operation: "derive", sourceConcernId: "focus", explorationMode: "deepen", transition: "replace", description: "検証方法を確認する", whyItMatters: "結果の信頼性を判断するため" }], "event-5", () => "successor");
    expect(committed.state.concerns).toMatchObject([{ id: "focus", status: "satisfied" }, { id: "successor", status: "active", description: "検証方法を確認する" }]);
    expect(committed.changes.at(-1)).toMatchObject({ target: "concerns", before: [{ id: "focus", status: "active" }] });
    expect(committed.concernActivities).toEqual([
      { concernId: "focus", kind: "status-changed", eventId: "event-5" },
      { concernId: "successor", kind: "derived", eventId: "event-5" }
    ]);
    expect(patched.state.concerns).toMatchObject([{ id: "focus", status: "active" }]);
  });

  it("FR-67: keeps the source active when a derived Concern omits transition", () => {
    const service = new AgentStatePatchService();
    const populated: CurrentAgentState = { ...state, concerns: [{ id: "focus", description: "調査する", whyItMatters: "判断するため", status: "active" }] };
    const patched = service.initial("a", populated);
    const committed = service.applyConcernProposals(patched, [{ operation: "derive", sourceConcernId: "focus", explorationMode: "bridge", description: "別領域の比較対象を調べる", whyItMatters: "自分の関心がどこまで通じるか確かめるため" }], "event-6", () => "parallel");
    expect(committed.state.concerns).toMatchObject([{ id: "focus", status: "active" }, { id: "parallel", status: "active" }]);
    expect(committed.concernActivities).toEqual([{ concernId: "parallel", kind: "derived", eventId: "event-6" }]);
  });

  it("FR-25: records a creation as Concern Activity without asking the model for timestamps", () => {
    const service = new AgentStatePatchService();
    const patched = service.initial("a", state);
    const committed = service.applyConcernProposals(patched, [{ operation: "create", description: "新しい対象を確かめる", whyItMatters: "判断材料を増やすため" }], "event-7", () => "created");
    expect(committed.concernActivities).toEqual([{ concernId: "created", kind: "created", eventId: "event-7" }]);
  });
});
