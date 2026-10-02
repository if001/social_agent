import { AgentActionSchema, AgentCoreInputSchema, CandidateSchema, IntentionSchema, MessageEnvelopeSchema, ReviewDecisionSchema, canTransitionIntention } from "../../src/domain/contracts.js";
import { agentCoreInputFixture, messageFixture } from "../../src/testing/contract-fixtures.js";

describe("domain contracts", () => {
  it("represents every action and review decision", () => {
    for (const action of [
      { type: "respond", content: "Hello" }, { type: "tool", call: { id: "c", name: "web", input: {} } },
      { type: "wait", reason: "Later" }, { type: "refuse", reason: "Unsafe", basis: "system" }, { type: "no-action", reason: "Nothing due" }
    ]) expect(AgentActionSchema.safeParse(action).success).toBe(true);
    for (const decision of ["KEEP", "UPDATE", "MERGE", "DROP"]) expect(ReviewDecisionSchema.parse(decision)).toBe(decision);
  });

  it("keeps natural-language state and candidate evidence", () => {
    expect(CandidateSchema.safeParse({ id: "c", agentId: "a", target: "selfNarrative", proposal: "I increasingly value patient inquiry", reason: "Repeated experiences", evidenceMemoryIds: [], status: "pending", createdAt: "2026-01-01T00:00:00Z" }).success).toBe(false);
  });

  it("enforces intention transitions", () => {
    expect(canTransitionIntention("active", "completed")).toBe(true);
    expect(canTransitionIntention("completed", "active")).toBe(false);
    expect(IntentionSchema.safeParse({ id: "i", agentId: "a", description: "Learn", status: "superseded", reason: "Refined", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }).success).toBe(false);
  });

  it("rejects hop, attempt, TTL and ownership violations", () => {
    expect(MessageEnvelopeSchema.safeParse(messageFixture({ hop: 33 })).success).toBe(false);
    expect(MessageEnvelopeSchema.safeParse(messageFixture({ attempt: 33 })).success).toBe(false);
    expect(MessageEnvelopeSchema.safeParse(messageFixture({ expiresAt: "2025-01-01T00:00:00Z" })).success).toBe(false);
    const input = agentCoreInputFixture();
    expect(AgentCoreInputSchema.safeParse({ ...input, memories: [{ id: "m", agentId: "agent-b", kind: "episodic", content: "Other experience", createdAt: "2026-01-01T00:00:00Z", relatedSubjectIds: [], relatedIntentionIds: [], importance: "Relevant", evidenceEventIds: [] }] }).success).toBe(false);
  });
});
