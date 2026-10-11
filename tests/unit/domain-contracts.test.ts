import { z } from "zod";
import { AgentActionSchema, AgentCoreInputSchema, AgentCoreOutputSchema, AgentStateSchema, AgentTurnSchema, EpisodicMemorySchema, EventAssessmentSchema, MessageEnvelopeSchema, SelfSchema } from "../../src/domain/contracts.js";
import { agentCoreInputFixture, messageFixture } from "../../src/testing/contract-fixtures.js";
import { observationFromEvent } from "../../src/infrastructure/persistence/postgres-agent-context-loader.js";

describe("domain contracts", () => {
  it("exposes immediate Emotion constraints and descriptions to structured output", () => {
    const schema = z.toJSONSchema(AgentCoreOutputSchema);
    const updates = AgentCoreOutputSchema.shape.internalChanges.shape.immediateStateUpdates;
    expect(JSON.stringify(schema)).toContain("今回の行動を生じさせる動機");
    expect(JSON.stringify(schema)).toContain('"const":"emotion"');
    const update = { target: "emotion", operation: "set", value: "嬉しい", reason: "挨拶された", evidenceIds: ["event-1"] };
    expect(updates.safeParse([update]).success).toBe(true);
    for (const invalid of [{ target: "mood" }, { operation: "append" }, { value: {} }]) {
      expect(updates.safeParse([{ ...update, ...invalid }]).success).toBe(false);
    }
  });

  it("represents every action", () => {
    for (const action of [
      { type: "respond", content: "Hello" },
      { type: "refuse", content: "I can't help with that.", reason: "Unsafe", basis: "system" },
      { type: "notify-no-execution", content: "今回は実行しない", reason: "新しい手掛かりがない" },
      { type: "no-external-action", reason: "Nothing due" }
    ]) expect(AgentActionSchema.safeParse(action).success).toBe(true);
    expect(AgentActionSchema.safeParse({ type: "refuse", reason: "private reason", basis: "personality" }).success).toBe(false);
    expect(AgentActionSchema.safeParse({ type: "tool", call: { id: "c", name: "web", input: {} } }).success).toBe(false);
    expect(AgentActionSchema.safeParse({ type: "wait", reason: "Later" }).success).toBe(false);
  });

  it("defines the redesigned natural-language Self, State, Memory, Assessment and Turn", () => {
    expect(SelfSchema.parse({ identity: "探究する個体", disposition: "曖昧さを急いで埋めない", selfStory: "対話から学んできた", commitments: ["約束を守る"] })).toBeDefined();
    expect(AgentStateSchema.parse({ mood: "静かに警戒している", concerns: [{ id: "c1", description: "関係を修復する", whyItMatters: "信頼を大切にしている", status: "active" }], relationships: [{ subjectId: "user", description: "率直に話せる相手" }] })).toBeDefined();
    expect(EpisodicMemorySchema.parse({ id: "m1", summary: "約束が破られた", significance: "信頼への懸念が生じた", subjects: ["user"], occurredAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:01Z" })).toBeDefined();
    expect(EventAssessmentSchema.parse({ meaning: "大切な約束が軽視された", feeling: "怒りと失望" })).toBeDefined();
    expect(AgentTurnSchema.safeParse({ desire: "境界を伝えたい", action: { type: "notify-no-execution", content: "今回は待つ", reason: "材料不足" } }).success).toBe(true);
    expect(AgentTurnSchema.safeParse({ desire: "待つ", action: { type: "wait" } }).success).toBe(false);
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
    expect(AgentCoreInputSchema.safeParse({ ...input, memories: [{ id: "m", agentId: "agent-b", kind: "episodic", content: "Other experience", occurredAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-02T00:00:00Z", relatedSubjectIds: [], importance: "Relevant", evidenceEventIds: [] }] }).success).toBe(false);
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
      interpretation: { subjectiveMeaning: "A meaningful event", activeMotive: { description: "Respond", evidenceIds: ["event-1"] } },
      internalChanges: { immediateStateUpdates: [{ target: "emotion", operation: "set", value: "interested", reason: "Useful exchange", evidenceIds: ["event-1"] }] },
      action: { type: "respond", content: "Understood" }
    });
    expect(parsed.internalChanges.immediateStateUpdates[0]?.target).toBe("emotion");
    expect(AgentCoreOutputSchema.safeParse({ ...parsed, internalChanges: { immediateStateUpdates: [{ target: "mood", operation: "set", value: "calm", reason: "Persistent", evidenceIds: [] }] } }).success).toBe(false);
  });
});
