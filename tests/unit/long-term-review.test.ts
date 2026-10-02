import { LongTermReviewService, compactNaturalLanguage, type LongTermReviewRepository, type ReviewCommit } from "../../src/application/long-term-review.js";
import type { Candidate, Memory } from "../../src/domain/contracts.js";

const candidate: Candidate = { id: "candidate", agentId: "a", target: "selfNarrative", proposal: "I value patience", reason: "Repeated evidence", evidenceMemoryIds: ["memory"], status: "pending", createdAt: "2026-01-01T00:00:00Z" };
const memory: Memory = { id: "memory", agentId: "a", kind: "self-related", content: "I was patient", createdAt: "2026-01-01T00:00:00Z", relatedSubjectIds: [], relatedIntentionIds: [], importance: "Strong evidence", evidenceEventIds: ["event"] };
const repository = (commits: ReviewCommit[], evidence: readonly Memory[] = [memory]): LongTermReviewRepository => ({ loadCandidate: () => Promise.resolve(candidate), loadEvidence: () => Promise.resolve(evidence), loadCurrentValue: () => Promise.resolve("I learn"), commit: (review) => { commits.push(review); return Promise.resolve(); } });

describe("LongTermReviewService", () => {
  it.each([
    ["KEEP", undefined, "kept"], ["UPDATE", "I value patience", "applied"], ["MERGE", "I learn patiently", "merged"], ["DROP", undefined, "dropped"]
  ] as const)("handles %s", async (decision, value, status) => {
    const commits: ReviewCommit[] = []; const service = new LongTermReviewService(repository(commits), { review: () => Promise.resolve({ decision, ...(value === undefined ? {} : { value }), reason: "Reviewed evidence" }) });
    await service.review("candidate", new AbortController().signal); expect(commits[0]?.status).toBe(status); expect(commits[0]?.after).toBe(value);
  });
  it("rejects missing and foreign evidence before commit", async () => {
    const commits: ReviewCommit[] = []; const harness = { review: () => Promise.resolve({ decision: "KEEP" as const, reason: "Keep" }) };
    await expect(new LongTermReviewService(repository(commits, []), harness).review("candidate", new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(new LongTermReviewService(repository(commits, [{ ...memory, agentId: "b" }]), harness).review("candidate", new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" }); expect(commits).toEqual([]);
  });
  it("compacts duplicate and excess long-term text", () => { expect(compactNaturalLanguage(["a", "a", "b", "c"], 2)).toEqual(["a", "b; c"]); });
});
