import { ContextBuilder, estimateTokens } from "../../src/application/context-builder.js";
import { FakeEmbeddingProvider, OllamaEmbeddingProvider } from "../../src/infrastructure/embedding/ollama-embedding.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import type { Memory } from "../../src/domain/contracts.js";
import { buildRelevantMemoryQuery } from "../../src/application/memory-query.js";

describe("embedding and context", () => {
  it("FR-8, NFR-3: bounds concerns in the canonical state", () => {
    const input = agentCoreInputFixture();
    input.state.concerns = Array.from({ length: 14 }, (_, index) => ({ id: `c${String(index)}`, description: `concern-${String(index)}`, whyItMatters: "important", status: "active" as const }));
    const result = new ContextBuilder().build(input, { maxTokens: 6_000, maxMemories: 5, maxSocialContexts: 1 });
    expect(result.state.concerns).toHaveLength(12);
  });
  it("NFR-3: returns deterministic fake vectors and validates local dimensions", async () => {
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

  it("NFR-1, NFR-3: enforces ownership, category caps, budget and stable tie breaks", () => {
    const input = agentCoreInputFixture();
    const memory = (id: string, agentId = "agent-a"): Memory => ({ id, agentId, kind: "episodic", content: `Memory ${id}`, occurredAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-02T00:00:00Z", relatedSubjectIds: [], importance: "Useful", retrievalPriority: "normal", evidenceEventIds: [] });
    const result = new ContextBuilder().build({ ...input, memories: [memory("b"), memory("a"), memory("foreign", "agent-b")], memoryRetrievalTrace: [{ memoryId: "b", finalRank: 1, matchedBy: ["keyword", "recency"], kind: "episodic", selected: true }, { memoryId: "a", finalRank: 2, matchedBy: ["recency"], kind: "episodic", selected: true }] }, { maxTokens: 2_000, maxMemories: 1, maxSocialContexts: 1 });
    expect(result.memories.map(({ id }) => id)).toEqual(["b"]);
    expect(result.memoryRetrievalTrace.find(({ memoryId }) => memoryId === "a")).toMatchObject({ selected: false, exclusionReason: "context-budget" });
    expect(() => new ContextBuilder().build({ ...input, memories: [] }, { maxTokens: 1, maxMemories: 1, maxSocialContexts: 1 })).toThrow("too small");
  });

  it("NFR-3: bounds required state and drops oversized Observation content before budgeting", () => {
    const input = agentCoreInputFixture();
    input.observation = { ...input.observation, summary: "s".repeat(2_000), facts: Array.from({ length: 20 }, () => "f".repeat(500)), content: { markdown: "x".repeat(100_000) } };
    input.currentSelf = { ...input.currentSelf, selfStory: "n".repeat(10_000), commitments: Array.from({ length: 30 }, () => "i".repeat(1_000)) };
    const result = new ContextBuilder().build(input, { maxTokens: 4_000, maxMemories: 1, maxSocialContexts: 1 });
    expect(result.observation.summary).toHaveLength(1_000);
    expect(result.observation.facts).toHaveLength(8);
    expect(result.observation.content).toBeUndefined();
    expect(result.currentSelf.selfStory).toHaveLength(1_000);
    expect(result.currentSelf.commitments).toHaveLength(12);
  });

  it("FR-9: keeps only the explicit previous Assessment as minimal affective context", () => {
    const input = agentCoreInputFixture();
    input.previousAssessment = { occurredAt: "2026-01-02T02:54:05.000Z", meaning: "検索結果が期待と違った", feeling: "少し苛立っている" };
    const result = new ContextBuilder().build(input, { maxTokens: 4_000, maxMemories: 1, maxSocialContexts: 1 });
    expect(result.previousAssessment).toEqual(input.previousAssessment);
  });

  it("NFR-3: builds a bounded deterministic query from observation and canonical state", () => {
    const input = agentCoreInputFixture();
    input.state = { ...input.state, mood: "発表を慎重に支援したい", relationships: [{ subjectId: "user", description: "発表準備を率直に相談する関係" }] };
    const query = buildRelevantMemoryQuery({ observation: input.observation, state: input.state });
    expect(query.text).toContain("発表を慎重に支援したい");
    expect(query.subjectIds).toEqual(["user"]);
    expect(query.keywords.length).toBeGreaterThan(0);
    expect(buildRelevantMemoryQuery({ observation: input.observation, state: input.state })).toEqual(query);
  });

  it("FR-7, NFR-3: bounds relationship count and text in canonical state", () => {
    const input = agentCoreInputFixture();
    input.state.relationships = Array.from({ length: 14 }, (_, index) => ({ subjectId: `subject-${String(index)}`, description: "s".repeat(800) }));
    const result = new ContextBuilder().build(input, { maxTokens: 6_000, maxMemories: 2, maxSocialContexts: 24 });
    expect(result.state.relationships).toHaveLength(12);
    expect(result.state.relationships.every(({ description }) => description.length <= 600)).toBe(true);
  });

  it("FR-30: keeps recent experience as whole events and removes oldest events for budget", () => {
    const input = agentCoreInputFixture();
    input.recentExperiences = Array.from({ length: 10 }, (_, index) => ({ eventId: `history-${String(index)}`, runId: `run-${String(index)}`, agentId: input.run.agentId, occurredAt: `2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`, eventKind: index % 2 === 0 ? "user-message" as const : "internal" as const, observation: { summary: `event-${String(index)}-${"x".repeat(300)}`, facts: [] }, steps: [{ type: "action" as const, action: { type: "no-external-action" as const, reason: `result-${String(index)}` } }], progressChanged: false }));
    const result = new ContextBuilder().build(input, { maxTokens: 3_000, maxMemories: 1, maxSocialContexts: 1 });
    expect(result.recentExperiences.length).toBeLessThanOrEqual(4);
    expect(result.recentExperiences.at(-1)?.eventId).toBe("history-9");
    expect(result.recentExperiences.every(({ observation }) => observation.summary.endsWith("x".repeat(300)))).toBe(true);
  });

  it("NFR-4: keeps the production 4,500 token context budget", () => {
    const input = agentCoreInputFixture();
    const memory = (id: string): Memory => ({ id, agentId: input.run.agentId, kind: "episodic", content: "記憶の本文。".repeat(400), occurredAt: input.run.occurredAt, createdAt: input.run.occurredAt, relatedSubjectIds: [], importance: "重要", retrievalPriority: "normal", evidenceEventIds: [] });
    input.memories = Array.from({ length: 10 }, (_, index) => memory(`budget-${String(index)}`));
    input.memoryRetrievalTrace = input.memories.map((item, index) => ({ memoryId: item.id, finalRank: index + 1, matchedBy: ["recency" as const], kind: item.kind, selected: true }));
    input.recentExperiences = Array.from({ length: 3 }, (_, index) => ({ eventId: `budget-event-${String(index)}`, runId: `budget-run-${String(index)}`, agentId: input.run.agentId, occurredAt: `2026-01-0${String(index + 1)}T00:00:00.000Z`, eventKind: "user-message" as const, observation: { summary: "x".repeat(2_000), facts: [] }, steps: [{ type: "action" as const, action: { type: "no-external-action" as const, reason: "done" } }], progressChanged: false }));
    const result = new ContextBuilder().build(input, { maxTokens: 4_500, maxMemories: 5, maxSocialContexts: 1 });
    expect(estimateTokens(result)).toBeLessThanOrEqual(4_500);
    expect(result.memories.length).toBeLessThanOrEqual(5);
  });

  it("FR-29: deduplicates ordinary episodic Memory covered by Recent Experience", () => {
    const input = agentCoreInputFixture(); const eventId = "recent-event";
    input.recentExperiences = [{ eventId, runId: "recent-run", agentId: input.run.agentId, occurredAt: input.run.occurredAt, eventKind: "user-message", observation: { summary: "recent exchange", facts: [] }, steps: [{ type: "action", action: { type: "respond", content: "answer" } }], progressChanged: false }];
    const makeMemory = (id: string, kind: Memory["kind"], priority: Memory["retrievalPriority"], evidenceEventIds: string[]): Memory => ({ id, agentId: input.run.agentId, kind, content: id, occurredAt: input.run.occurredAt, createdAt: input.run.occurredAt, relatedSubjectIds: [], importance: "useful", retrievalPriority: priority, evidenceEventIds });
    input.memories = [makeMemory("duplicate", "episodic", "normal", [eventId]), makeMemory("important", "episodic", "high", [eventId]), makeMemory("semantic", "semantic", "normal", [eventId]), makeMemory("older", "episodic", "normal", ["older-event"])];
    input.memoryRetrievalTrace = input.memories.map((item, index) => ({ memoryId: item.id, finalRank: index + 1, matchedBy: ["recency" as const], kind: item.kind, selected: true }));
    const logs: { message: string; context?: Readonly<Record<string, unknown>> }[] = []; const logger = { child: () => logger, log: (_level: string, message: string, context?: Readonly<Record<string, unknown>>) => { logs.push({ message, ...(context === undefined ? {} : { context }) }); } } as ConstructorParameters<typeof ContextBuilder>[0];
    const result = new ContextBuilder(logger).build(input, { maxTokens: 8_000, maxMemories: 10, maxSocialContexts: 1 });
    expect(result.memories.map(({ id }) => id)).toEqual(["important", "semantic", "older"]);
    expect(result.memoryRetrievalTrace.find(({ memoryId }) => memoryId === "duplicate")).toMatchObject({ selected: false, exclusionReason: "recent-experience-duplicate" });
    expect(logs.find(({ message }) => message === "context.memory_duplicates_excluded")?.context?.count).toBe(1);
  });
});
