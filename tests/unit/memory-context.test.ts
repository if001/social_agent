import { ContextBuilder } from "../../src/application/context-builder.js";
import { FakeEmbeddingProvider, OllamaEmbeddingProvider } from "../../src/infrastructure/embedding/ollama-embedding.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import type { Memory } from "../../src/domain/contracts.js";

describe("embedding and context", () => {
  it("returns deterministic fake vectors and validates local dimensions", async () => {
    const fake = new FakeEmbeddingProvider({ hello: [1, 0] });
    await expect(fake.embed(["hello"], new AbortController().signal)).resolves.toEqual([[1, 0]]);
    const requests: { url: string; authorization: string | null }[] = [];
    const fetcher: typeof fetch = (input, init) => { const headers = new Headers(init?.headers); const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url; requests.push({ url, authorization: headers.get("authorization") }); return Promise.resolve(new Response(JSON.stringify({ embeddings: [[1, 0]] }), { status: 200 })); };
    const local = new OllamaEmbeddingProvider({ baseUrl: "http://local:11434", model: "embed", dimension: 2 }, fetcher);
    await expect(local.embed(["hello"], new AbortController().signal)).resolves.toEqual([[1, 0]]);
    expect(requests).toEqual([{ url: "http://local:11434/api/embed", authorization: null }]);
    const wrong = new OllamaEmbeddingProvider({ baseUrl: "http://local", model: "embed", dimension: 3 }, fetcher);
    await expect(wrong.embed(["hello"], new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("enforces ownership, category caps, budget and stable tie breaks", () => {
    const input = agentCoreInputFixture();
    const memory = (id: string, agentId = "agent-a"): Memory => ({ id, agentId, kind: "episodic", content: `Memory ${id}`, createdAt: "2026-01-01T00:00:00Z", relatedSubjectIds: [], relatedIntentionIds: [], importance: "Useful", evidenceEventIds: [] });
    const result = new ContextBuilder().build({ ...input, memories: [memory("b"), memory("a"), memory("foreign", "agent-b")] }, { maxTokens: 2_000, maxMemories: 1, maxSocialContexts: 1 });
    expect(result.memories.map(({ id }) => id)).toEqual(["a"]);
    expect(() => new ContextBuilder().build({ ...input, memories: [] }, { maxTokens: 1, maxMemories: 1, maxSocialContexts: 1 })).toThrow("too small");
  });
});
