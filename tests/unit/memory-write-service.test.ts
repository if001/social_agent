import type { PoolClient } from "pg";
import { describe, expect, it, vi } from "vitest";

import { MemoryWriteService } from "../../src/application/memory-write-service.js";
import { MemoryIntentSchema } from "../../src/domain/contracts.js";

describe("FR-57, NFR-15, AC-12, AC-17: MemoryWriteService", () => {
  it("AC-17: rejects Relationship and Concern as MemoryIntent targets", () => {
    expect(MemoryIntentSchema.safeParse({ content: "関係", reason: "理由", evidenceEventIds: [], confidence: "medium", target: "relationship" }).success).toBe(false);
    expect(MemoryIntentSchema.safeParse({ content: "関係", reason: "理由", evidenceEventIds: [], confidence: "medium", target: "semantic" }).success).toBe(true);
  });

  it("records a no-op when the candidate version changed before update", async () => {
    const query = vi.fn((sql: string) => {
      if (sql.includes("pg_advisory_xact_lock")) return Promise.resolve({ rows: [] });
      if (sql.includes("SELECT id,kind,content,importance,version")) return Promise.resolve({ rows: [{ id: "existing", kind: "semantic", content: "ユーザーAは技術の話を好む", importance: "重要", version: 0, evidence_event_ids: [] }] });
      if (sql.includes("UPDATE memories")) return Promise.resolve({ rows: [], rowCount: 0 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const service = new MemoryWriteService({ query } as unknown as PoolClient, { next: () => "mutation-1" }, () => new Date("2026-10-31T00:00:00Z"));
    await expect(service.apply("a", { content: "ユーザーAは技術の話を好む", reason: "再利用", evidenceEventIds: ["event-1"], confidence: "medium", target: "semantic" })).resolves.toEqual({ operation: "no-op", memoryId: "existing" });
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO memory_mutations"), expect.arrayContaining(["no-op"]));
  });
});
