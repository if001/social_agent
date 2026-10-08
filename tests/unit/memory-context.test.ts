import { ContextBuilder } from "../../src/application/context-builder.js";
import { FakeEmbeddingProvider, OllamaEmbeddingProvider } from "../../src/infrastructure/embedding/ollama-embedding.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import type { Memory } from "../../src/domain/contracts.js";
import { buildRelevantMemoryQuery } from "../../src/application/memory-query.js";

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
    const memory = (id: string, agentId = "agent-a"): Memory => ({ id, agentId, kind: "episodic", content: `Memory ${id}`, occurredAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-02T00:00:00Z", relatedSubjectIds: [], relatedIntentionIds: [], importance: "Useful", retrievalPriority: "normal", evidenceEventIds: [] });
    const result = new ContextBuilder().build({ ...input, memories: [memory("b"), memory("a"), memory("foreign", "agent-b")], memoryRetrievalTrace: [{ memoryId: "b", finalRank: 1, matchedBy: ["keyword", "recency"], kind: "episodic", selected: true }, { memoryId: "a", finalRank: 2, matchedBy: ["recency"], kind: "episodic", selected: true }] }, { maxTokens: 2_000, maxMemories: 1, maxSocialContexts: 1 });
    expect(result.memories.map(({ id }) => id)).toEqual(["b"]);
    expect(result.memoryRetrievalTrace.find(({ memoryId }) => memoryId === "a")).toMatchObject({ selected: false, exclusionReason: "context-budget" });
    expect(() => new ContextBuilder().build({ ...input, memories: [] }, { maxTokens: 1, maxMemories: 1, maxSocialContexts: 1 })).toThrow("too small");
  });

  it("keeps at most six recent attempts for the owning Agent", () => {
    const input = agentCoreInputFixture();
    const attempts = Array.from({ length: 8 }, (_, index) => ({ id: `attempt-${String(index)}`, agentId: index === 7 ? "agent-b" : input.run.agentId, actionType: "respond" as const, inputSummary: index === 6 ? "q".repeat(600) : `question-${String(index)}`, resultSummary: "no progress", occurredAt: `2026-01-0${String(index + 1)}T00:00:00.000Z`, progressChanged: false }));
    const result = new ContextBuilder().build({ ...input, recentAttempts: attempts }, { maxTokens: 4_000, maxMemories: 1, maxSocialContexts: 1 });
    expect(result.recentAttempts).toHaveLength(6);
    expect(result.recentAttempts.every(({ agentId }) => agentId === input.run.agentId)).toBe(true);
    expect(result.recentAttempts[0]?.id).toBe("attempt-6");
    expect(result.recentAttempts[0]?.inputSummary).toHaveLength(480);
  });

  it("bounds required state and drops oversized Observation content before budgeting", () => {
    const input = agentCoreInputFixture();
    input.observation = { ...input.observation, summary: "s".repeat(2_000), facts: Array.from({ length: 20 }, () => "f".repeat(500)), content: { markdown: "x".repeat(100_000) } };
    input.self = { ...input.self, selfNarrative: "n".repeat(10_000), interests: Array.from({ length: 30 }, () => "i".repeat(1_000)) };
    const result = new ContextBuilder().build(input, { maxTokens: 4_000, maxMemories: 1, maxSocialContexts: 1 });
    expect(result.observation.summary).toHaveLength(1_000);
    expect(result.observation.facts).toHaveLength(8);
    expect(result.observation.content).toBeUndefined();
    expect(result.self.selfNarrative).toHaveLength(2_000);
    expect(result.self.interests).toHaveLength(16);
  });

  it("builds a bounded deterministic query from observation, state, intention and social context", () => {
    const input = agentCoreInputFixture();
    input.intentions = [{ id: "goal", agentId: input.run.agentId, description: "研究発表を支援する", status: "active", reason: "約束した", createdAt: input.run.occurredAt, updatedAt: input.run.occurredAt }];
    input.socialContext = [{ id: "social", agentId: input.run.agentId, subjectId: "user", subjectType: "user", description: "発表準備を率直に相談する関係", updatedAt: input.run.occurredAt }];
    input.dynamicState = { ...input.dynamicState, mood: "発表を慎重に支援したい" };
    const query = buildRelevantMemoryQuery(input);
    expect(query.text).toContain("発表を慎重に支援したい");
    expect(query.text).toContain("研究発表を支援する");
    expect(query.subjectIds).toEqual(["user"]);
    expect(query.intentionIds).toEqual(["goal"]);
    expect(query.keywords.length).toBeGreaterThan(0);
    expect(buildRelevantMemoryQuery(input)).toEqual(query);
  });

  it("reserves required context, then memories, and bounds selected state text", () => {
    const input = agentCoreInputFixture();
    input.intentions = Array.from({ length: 8 }, (_, index) => ({ id: `intention-${String(index)}`, agentId: input.run.agentId, description: "d".repeat(800), status: "active" as const, reason: "r".repeat(800), createdAt: input.run.occurredAt, updatedAt: input.run.occurredAt }));
    input.socialContext = Array.from({ length: 8 }, (_, index) => ({ id: `social-${String(index)}`, agentId: input.run.agentId, subjectId: `subject-${String(index)}`, subjectType: "user" as const, description: "s".repeat(800), updatedAt: input.run.occurredAt }));
    input.memories = [{ id: "relevant-memory", agentId: input.run.agentId, kind: "episodic", content: "important", occurredAt: input.run.occurredAt, createdAt: input.run.occurredAt, relatedSubjectIds: [], relatedIntentionIds: [], importance: "useful", retrievalPriority: "normal", evidenceEventIds: [input.run.eventId] }];
    const result = new ContextBuilder().build({ ...input, requiredIntentionIds: new Set(["intention-0"]), requiredSocialContextIds: new Set(["social-0"]) }, { maxTokens: 4_000, maxMemories: 2, maxSocialContexts: 24 });
    expect(result.intentions.length).toBeLessThanOrEqual(6);
    expect(result.socialContext.length).toBeLessThanOrEqual(6);
    expect(result.intentions[0]).toMatchObject({ id: "intention-0" });
    expect(result.socialContext[0]).toMatchObject({ id: "social-0" });
    expect(result.memories.map(({ id }) => id)).toContain("relevant-memory");
    expect(result.intentions.every(({ description, reason }) => description.length <= 500 && reason.length <= 500)).toBe(true);
    expect(result.socialContext.every(({ description }) => description.length <= 600)).toBe(true);
  });
});
