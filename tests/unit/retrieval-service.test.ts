import type { Pool } from "pg";
import { describe, expect, it, vi } from "vitest";

import { FakeEmbeddingProvider } from "../../src/infrastructure/embedding/ollama-embedding.js";
import { PostgresRetrievalService } from "../../src/infrastructure/persistence/postgres-retrieval-service.js";

const row = (overrides: Record<string, unknown>) => ({
  source: "conversation",
  id: "m1",
  kind: "episodic",
  content: "東京で友人と話した",
  importance: "普通",
  occurred_at: new Date("2026-01-01T00:00:00.000Z"),
  vector_rank: null,
  keyword_rank: null,
  subject_rank: null,
  recency_rank: "1",
  ...overrides
});

describe("FR-55, NFR-14: common RetrievalService", () => {
  it("FR-55: reports vector, keyword, subject and recency signals for both stores", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [
      row({ source: "conversation", id: "m1", vector_rank: "1", keyword_rank: "2", subject_rank: "1" }),
      row({ source: "background", id: "b1", vector_rank: "2", keyword_rank: "1", subject_rank: null })
    ] });
    const service = new PostgresRetrievalService({ query } as unknown as Pool, new FakeEmbeddingProvider({ 東京: [1, 0] }, 2));
    const items = await service.retrieve({ agentId: "a", query: "東京", scope: "all", limit: 5 });
    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({ source: "conversation", matchedBy: ["vector", "keyword", "subject", "recency"] });
    expect(items[1]).toMatchObject({ source: "background", matchedBy: ["vector", "keyword", "recency"] });
  });

  it("FR-55: scopes background by kind and applies subject filtering parameters", async () => {
    const query = vi.fn().mockResolvedValue({ rows: [row({})] });
    const service = new PostgresRetrievalService({ query } as unknown as Pool);
    await service.retrieve({ agentId: "a", query: "東京", scope: "all", kinds: ["episodic"], subjectIds: ["owner"], subjectFilter: true, limit: 3 });
    const params = query.mock.calls[0]?.[1] as unknown[];
    expect(params[4]).toEqual(["episodic"]);
    expect(params[6]).toBe(false);
    expect(params[8]).toBe(true);
    await service.retrieve({ agentId: "a", query: "東京", scope: "background", limit: 3 });
    const backgroundParams = query.mock.calls[1]?.[1] as unknown[];
    expect(backgroundParams[5]).toBe(false);
    expect(backgroundParams[6]).toBe(true);
  });
});
