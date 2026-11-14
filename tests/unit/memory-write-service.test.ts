import { describe, expect, it } from "vitest";

import { MemoryIntentSchema } from "../../src/domain/contracts.js";
import { mergeMemoryEvidence } from "../../src/infrastructure/persistence/memory-write-repository.js";

describe("FR-57, NFR-15, AC-12, AC-17: MemoryWriteService", () => {
  it("AC-17: rejects Relationship and Concern as MemoryIntent targets", () => {
    expect(MemoryIntentSchema.safeParse({ content: "関係", reason: "理由", evidenceEventIds: [], confidence: "medium", target: "relationship" }).success).toBe(false);
    expect(MemoryIntentSchema.safeParse({ content: "関係", reason: "理由", evidenceEventIds: [], confidence: "medium", target: "semantic" }).success).toBe(true);
    expect(MemoryIntentSchema.safeParse({ content: "自分の探索経験", reason: "次の方法を選ぶ", evidenceEventIds: ["event-1"], confidence: "medium", target: "episodic", perspective: "self", purpose: "user-context" }).success).toBe(false);
  });

  it("NFR-7: keeps evidence within sixteen IDs and prioritizes new evidence", () => {
    const existing = Array.from({ length: 16 }, (_, index) => `old-${String(index + 1)}`);
    expect(mergeMemoryEvidence(existing, ["new-1", "new-2"])).toEqual(["new-1", "new-2", ...existing.slice(0, 14)]);
  });

  it("NFR-7: de-duplicates evidence before applying the bound", () => {
    expect(mergeMemoryEvidence(["event-1", "event-2"], ["event-2", "event-3"])).toEqual(["event-2", "event-3", "event-1"]);
  });
});
