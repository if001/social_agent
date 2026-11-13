import { toModelRecordView } from "../../src/infrastructure/agent/model-record-view.js";

describe("toModelRecordView", () => {
  it("FR-77: removes canonical references and cursors recursively while retaining semantic content", () => {
    const result = toModelRecordView({
      id: "event-1", agentId: "agent-1", occurredAt: "2026-11-13T00:00:00.000Z", summary: "展示に行く予定",
      nested: { memoryId: "memory-1", subjectIds: ["user-1"], cursor: "page-2", content: "来週の展示" },
      rows: [{ eventId: "event-2", reason: "会話で明示された" }]
    });
    expect(result).toEqual({
      occurredAt: "2026-11-13T00:00:00.000Z", summary: "展示に行く予定",
      nested: { content: "来週の展示" }, rows: [{ reason: "会話で明示された" }]
    });
  });
});
