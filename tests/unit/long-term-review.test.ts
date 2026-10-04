import { LongTermReviewService, compactNaturalLanguage, type LongTermReviewRepository, type ReviewCommit, type ReviewOutput } from "../../src/application/long-term-review.js";
import { LongTermReviewDeepAgentHarness, longTermReviewSystemPrompt } from "../../src/infrastructure/agent/long-term-review-harness.js";
import type { Candidate, Memory, Observation } from "../../src/domain/contracts.js";

const candidate: Candidate = { id: "candidate", agentId: "a", target: "selfNarrative", proposal: "I value patience", reason: "Repeated evidence", evidenceMemoryIds: ["memory"], evidenceEventIds: [], status: "pending", createdAt: "2026-01-01T00:00:00Z" };
const candidate2: Candidate = { ...candidate, id: "candidate-2", proposal: "I verify before acting" };
const memory: Memory = { id: "memory", agentId: "a", kind: "self-related", content: "I was patient", createdAt: "2026-01-01T00:00:00Z", relatedSubjectIds: [], relatedIntentionIds: [], importance: "Strong evidence", retrievalPriority: "normal", evidenceEventIds: ["event"] };
const event: Observation = { eventId: "event", summary: "The user adopted the proposal", facts: ["The proposal was adopted"], observedAt: "2026-01-01T00:00:00Z" };
const repository = (commits: ReviewCommit[], evidence: { memories: readonly Memory[]; events: readonly Observation[] } = { memories: [memory], events: [] }, candidates: readonly Candidate[] = [candidate]): LongTermReviewRepository => ({ loadCandidates: (ids) => Promise.resolve(candidates.filter(({ id }) => ids.includes(id))), loadEvidence: () => Promise.resolve(evidence), loadCurrentValue: () => Promise.resolve("I learn"), commit: (review) => { commits.push(review); return Promise.resolve(); } });
const output = (decision: "KEEP" | "UPDATE" | "MERGE" | "DROP", value?: string): ReviewOutput => ({ decisions: [{ candidateId: "candidate", decision, reason: "Reviewed evidence" }], ...(value === undefined ? {} : { stateUpdate: { value, reason: "Reviewed evidence", evidenceMemoryIds: ["memory"], evidenceEventIds: [] } }) });

describe("LongTermReviewService", () => {
  it.each([
    ["KEEP", undefined, "pending"], ["UPDATE", "I value patience", "applied"], ["MERGE", "I learn patiently", "merged"], ["DROP", undefined, "dropped"]
  ] as const)("handles %s", async (decision, value, status) => {
    const commits: ReviewCommit[] = []; const service = new LongTermReviewService(repository(commits), { review: () => Promise.resolve(output(decision, value)) });
    await service.review("candidate", new AbortController().signal); expect(commits[0]?.candidateDecisions[0]?.status).toBe(status); expect(commits[0]?.after).toBe(value);
  });

  it("reviews multiple Candidates together and produces one consolidated update", async () => {
    const commits: ReviewCommit[] = [];
    const service = new LongTermReviewService(repository(commits, { memories: [memory], events: [] }, [candidate, candidate2]), { review: (input) => {
      expect(input.candidates).toHaveLength(2);
      return Promise.resolve({ decisions: [{ candidateId: "candidate", decision: "MERGE", reason: "Related" }, { candidateId: "candidate-2", decision: "MERGE", reason: "Related" }], stateUpdate: { value: "I patiently verify before acting", reason: "Combined", evidenceMemoryIds: ["memory"], evidenceEventIds: [] } });
    } });
    await service.review(["candidate", "candidate-2"], new AbortController().signal);
    expect(commits[0]).toMatchObject({ after: "I patiently verify before acting", candidateDecisions: [{ status: "merged" }, { status: "merged" }] });
  });

  it("rejects missing, foreign, mixed-target, incomplete and invented evidence before commit", async () => {
    const commits: ReviewCommit[] = []; const harness = { review: () => Promise.resolve(output("KEEP")) };
    await expect(new LongTermReviewService(repository(commits, { memories: [], events: [] }), harness).review("candidate", new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(new LongTermReviewService(repository(commits, { memories: [{ ...memory, agentId: "b" }], events: [] }), harness).review("candidate", new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(new LongTermReviewService(repository(commits, { memories: [memory], events: [] }, [candidate, { ...candidate2, target: "acquiredDisposition" }]), harness).review(["candidate", "candidate-2"], new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(new LongTermReviewService(repository(commits), { review: () => Promise.resolve({ decisions: [] }) }).review("candidate", new AbortController().signal)).rejects.toBeTruthy();
    await expect(new LongTermReviewService(repository(commits), { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate", decision: "UPDATE" as const, reason: "x" }], stateUpdate: { value: "x", reason: "x", evidenceMemoryIds: ["invented"], evidenceEventIds: [] } }) }).review("candidate", new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(commits).toEqual([]);
  });

  it("uses a separate Japanese Review prompt and repairs invalid structured output", async () => {
    let calls = 0;
    const harness = new LongTermReviewDeepAgentHarness({ invoke: () => Promise.resolve({ structuredResponse: calls++ === 0 ? {} : output("KEEP") }) });
    await expect(harness.review({ candidates: [candidate], evidenceMemories: [memory], evidenceEvents: [], currentValue: "I learn" }, new AbortController().signal)).resolves.toEqual(output("KEEP"));
    expect(calls).toBe(2);
    expect(longTermReviewSystemPrompt).toContain("Long-term Review Core");
    expect(longTermReviewSystemPrompt).toContain("全Candidate");
  });

  it("accepts an Event-only Candidate only when its Observation is loaded", async () => {
    const commits: ReviewCommit[] = []; const eventCandidate: Candidate = { ...candidate, evidenceMemoryIds: [], evidenceEventIds: ["event"] };
    const service = new LongTermReviewService(repository(commits, { memories: [], events: [event] }, [eventCandidate]), { review: (input) => {
      expect(input.evidenceEvents).toEqual([event]);
      return Promise.resolve({ decisions: [{ candidateId: "candidate", decision: "UPDATE", reason: "Explicit event" }], stateUpdate: { value: "I contribute useful proposals", reason: "Explicit event", evidenceMemoryIds: [], evidenceEventIds: ["event"] } });
    } });
    await service.review("candidate", new AbortController().signal);
    expect(commits[0]?.evidenceEventIds).toEqual(["event"]);
  });

  it("compacts duplicate and excess long-term text", () => { expect(compactNaturalLanguage(["a", "a", "b", "c"], 2)).toEqual(["a", "b; c"]); });
});
