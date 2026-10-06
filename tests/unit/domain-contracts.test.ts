import { AgentActionSchema, AgentCoreInputSchema, AgentCoreOutputSchema, CandidateSchema, ContinuityOutputSchema, IntentionSchema, IntentionTriggerSchema, MemoryExtractionOutputSchema, MessageEnvelopeSchema, ReviewDecisionSchema, canTransitionIntention } from "../../src/domain/contracts.js";
import { agentCoreInputFixture, messageFixture } from "../../src/testing/contract-fixtures.js";
import { observationFromEvent } from "../../src/infrastructure/persistence/postgres-agent-context-loader.js";

describe("domain contracts", () => {
  it("represents every action and review decision", () => {
    for (const action of [
      { type: "respond", content: "Hello" },
      { type: "wait", reason: "Later" }, { type: "refuse", reason: "Unsafe", basis: "system" }, { type: "no-action", reason: "Nothing due" }
    ]) expect(AgentActionSchema.safeParse(action).success).toBe(true);
    expect(AgentActionSchema.safeParse({ type: "tool", call: { id: "c", name: "web", input: {} } }).success).toBe(false);
    for (const decision of ["KEEP", "UPDATE", "MERGE", "DROP"]) expect(ReviewDecisionSchema.parse(decision)).toBe(decision);
  });

  it("keeps natural-language state and candidate evidence", () => {
    expect(CandidateSchema.safeParse({ id: "c", agentId: "a", target: "selfNarrative", proposal: "I increasingly value patient inquiry", reason: "Repeated experiences", evidenceMemoryIds: [], evidenceEventIds: [], status: "pending", createdAt: "2026-01-01T00:00:00Z" }).success).toBe(false);
    expect(CandidateSchema.safeParse({ id: "c", agentId: "a", target: "semanticMemory", proposal: "The user prefers concise plans", reason: "Explicit statement", evidenceMemoryIds: [], evidenceEventIds: ["event-1"], status: "pending", createdAt: "2026-01-01T00:00:00Z" }).success).toBe(true);
  });

  it("enforces intention transitions", () => {
    expect(canTransitionIntention("active", "completed")).toBe(true);
    expect(canTransitionIntention("completed", "active")).toBe(false);
    expect(IntentionSchema.safeParse({ id: "i", agentId: "a", description: "Learn", status: "superseded", reason: "Refined", createdAt: "2026-01-01T00:00:00Z", updatedAt: "2026-01-01T00:00:00Z" }).success).toBe(false);
  });

  it("accepts all four intention trigger forms", () => {
    expect(IntentionTriggerSchema.parse({ kind: "time", at: "2026-01-02T00:00:00Z" })).toMatchObject({ kind: "time" });
    expect(IntentionTriggerSchema.parse({ kind: "event", eventKinds: ["user-message"], keywords: ["計画"] })).toMatchObject({ kind: "event" });
    expect(IntentionTriggerSchema.parse({ kind: "idle", idleForMs: 60_000 })).toMatchObject({ kind: "idle" });
    expect(IntentionTriggerSchema.parse({ kind: "manual-review" })).toMatchObject({ kind: "manual-review" });
  });

  it("maps every Event kind to an objective, provenance-aware Observation", () => {
    for (const kind of ["user-message", "tool-result", "time", "external", "internal", "system"] as const) {
      const observation = observationFromEvent({ id: `event-${kind}`, agentId: "a", kind, occurredAt: "2026-01-01T00:00:00Z", payload: { text: "reported fact", actorId: "actor", actorType: kind === "external" ? "agent" : "human", sourceType: kind === "external" ? "agent" : "terminal", provenance: { channel: "test" } }, causationId: "cause", correlationId: "correlation" });
      expect(observation).toMatchObject({ kind, actor: { id: "actor" }, causationId: "cause", correlationId: "correlation", content: { text: "reported fact" } });
      expect(observation.source?.direct).toBe(kind !== "external" && kind !== "tool-result");
    }
  });

  it("rejects hop, attempt, TTL and ownership violations", () => {
    expect(MessageEnvelopeSchema.safeParse(messageFixture({ hop: 33 })).success).toBe(false);
    expect(MessageEnvelopeSchema.safeParse(messageFixture({ attempt: 33 })).success).toBe(false);
    expect(MessageEnvelopeSchema.safeParse(messageFixture({ expiresAt: "2025-01-01T00:00:00Z" })).success).toBe(false);
    const input = agentCoreInputFixture();
    expect(AgentCoreInputSchema.safeParse({ ...input, memories: [{ id: "m", agentId: "agent-b", kind: "episodic", content: "Other experience", occurredAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-02T00:00:00Z", relatedSubjectIds: [], relatedIntentionIds: [], importance: "Relevant", evidenceEventIds: [] }] }).success).toBe(false);
  });

  it("requires Shared, Initial, and Acquired Disposition inside Self", () => {
    const input = agentCoreInputFixture();
    expect(AgentCoreInputSchema.safeParse(input).success).toBe(true);
    const legacySelf = { ...input.self } as Record<string, unknown>;
    delete legacySelf.disposition;
    legacySelf.initialDisposition = "legacy";
    legacySelf.acquiredDisposition = "legacy";
    expect(AgentCoreInputSchema.safeParse({ ...input, self: legacySelf }).success).toBe(false);
  });

  it("separates immediate Interaction state from persistent Post-process proposals", () => {
    const parsed = AgentCoreOutputSchema.parse({
      interpretation: { subjectiveMeaning: "A meaningful event" },
      internalChanges: { immediateStateUpdates: [{ target: "emotion", operation: "set", value: "interested", reason: "Useful exchange", evidenceIds: ["event-1"] }] },
      action: { type: "respond", content: "Understood" }
    });
    expect(parsed.internalChanges.immediateStateUpdates[0]?.target).toBe("emotion");
    expect(AgentCoreOutputSchema.safeParse({ ...parsed, internalChanges: { immediateStateUpdates: [{ target: "mood", operation: "set", value: "calm", reason: "Persistent", evidenceIds: [] }] } }).success).toBe(false);
    expect(ContinuityOutputSchema.safeParse({ persistentStateUpdates: [{ target: "mood", operation: "set", value: "calm", reason: "Persistent", evidenceIds: [] }], intentionProposals: [] }).success).toBe(true);
    expect(MemoryExtractionOutputSchema.safeParse({ memoryProposals: [] }).success).toBe(true);
  });

  it("requires valid existing intention update references", () => {
    const base = { persistentStateUpdates: [] };
    expect(ContinuityOutputSchema.safeParse({ ...base, intentionProposals: [{ operation: "update", intentionId: "i", status: "superseded", reason: "Refined" }] }).success).toBe(false);
    expect(ContinuityOutputSchema.safeParse({ ...base, intentionProposals: [{ operation: "update", intentionId: "i", status: "superseded", supersededByIntentionId: "j", reason: "Refined" }] }).success).toBe(true);
  });
});
