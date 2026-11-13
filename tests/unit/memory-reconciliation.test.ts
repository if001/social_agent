import { describe, expect, it } from "vitest";
import { selectReactivationAnchors } from "../../src/application/memory-reconciliation.js";

describe("FR-72: Memory Reconciliation selector", () => {
  it("selects one explainable anchor per reason and never scans beyond four", () => {
    const anchors = selectReactivationAnchors([
      { memoryId: "f-old", reason: "formation", occurredAt: "2026-01-01T00:00:00Z" },
      { memoryId: "f-new", reason: "formation", occurredAt: "2026-02-01T00:00:00Z" },
      { memoryId: "c", reason: "concern", occurredAt: "2026-01-01T00:00:00Z" },
      { memoryId: "u", reason: "unreviewed", occurredAt: "2026-01-01T00:00:00Z" },
      { memoryId: "d", reason: "distant", occurredAt: "2026-01-01T00:00:00Z" }
    ]);
    expect(anchors.map(({ memoryId }) => memoryId)).toEqual(["f-new", "c", "u", "d"]);
  });

  it("selects at most one explainable anchor for each reactivation reason", () => {
    const selected = selectReactivationAnchors([
      { memoryId: "older", reason: "formation", occurredAt: "2026-01-01T00:00:00.000Z" },
      { memoryId: "newer", reason: "formation", occurredAt: "2026-01-02T00:00:00.000Z" },
      { memoryId: "concern", reason: "concern", occurredAt: "2026-01-01T00:00:00.000Z" },
      { memoryId: "unreviewed", reason: "unreviewed", occurredAt: "2026-01-01T00:00:00.000Z" },
      { memoryId: "distant", reason: "distant", occurredAt: "2026-01-01T00:00:00.000Z" },
      { memoryId: "duplicate", reason: "distant", occurredAt: "2026-01-03T00:00:00.000Z" }
    ]);
    expect(selected).toHaveLength(4);
    expect(selected.map(({ reason }) => reason)).toEqual(["formation", "concern", "unreviewed", "distant"]);
  });
});
