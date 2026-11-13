import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { normalizeOverfullMemoryEvidence } from "../../src/application/memory-evidence-normalization.js";
import { parseMemoryEvidenceNormalizationOptions } from "../../src/application/memory-evidence-normalization-cli.js";

describe("Memory evidence normalization", () => {
  it("reports over-limit Memory without writing in dry-run mode", async () => {
    const query = vi.fn().mockResolvedValueOnce({ rows: [{ id: "memory-1", agent_id: "a" }] });
    await expect(normalizeOverfullMemoryEvidence({ query } as unknown as Pool, { agentId: "a", apply: false })).resolves.toEqual({ scanned: 1, normalized: 0 });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it("clears only over-limit Memory when explicitly applied", async () => {
    const client = { query: vi.fn().mockResolvedValue({ rows: [{ id: "memory-1", agent_id: "a" }], rowCount: 1 }), release: vi.fn() };
    const pool = { query: vi.fn().mockResolvedValue({ rows: [{ id: "memory-1", agent_id: "a" }] }), connect: vi.fn().mockResolvedValue(client) };
    await expect(normalizeOverfullMemoryEvidence(pool as unknown as Pool, { apply: true })).resolves.toEqual({ scanned: 1, normalized: 1 });
    expect(client.query).toHaveBeenCalledWith(expect.stringContaining("UPDATE memories SET evidence_event_ids='[]'::jsonb"), ["memory-1", "a"]);
    expect(client.query).toHaveBeenCalledWith("COMMIT");
  });
});

describe("Memory evidence normalization CLI options", () => {
  it("is dry-run by default and limits an optional agent", () => {
    expect(parseMemoryEvidenceNormalizationOptions(["--agent-id", "shiro"])).toEqual({ agentId: "shiro", apply: false });
  });

  it("enables writes only with --apply", () => {
    expect(parseMemoryEvidenceNormalizationOptions(["--apply", "--agent-id", "shiro"])).toEqual({ agentId: "shiro", apply: true });
  });

  it("rejects malformed options", () => {
    expect(() => parseMemoryEvidenceNormalizationOptions(["--agent-id"])).toThrow("--agent-id requires a value");
    expect(() => parseMemoryEvidenceNormalizationOptions(["--unknown"])).toThrow("Usage:");
  });
});
