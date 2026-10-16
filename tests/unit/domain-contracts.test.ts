import { z } from "zod";
import { AgentActionSchema, AgentCoreInputSchema, AgentStateSchema, AgentTurnSchema, EpisodicMemorySchema, EventAssessmentSchema, MessageEnvelopeSchema, SelfSchema } from "../../src/domain/contracts.js";
import { agentCoreInputFixture, messageFixture } from "../../src/testing/contract-fixtures.js";
import { observationFromEvent } from "../../src/infrastructure/persistence/postgres-agent-context-loader.js";

describe("domain contracts", () => {
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

  it("bounds generated Agent Core text by each field's purpose", () => {
    const base = { desire: "具体的に話したい", action: { type: "respond" as const, content: "返答" } };
    expect(AgentTurnSchema.safeParse({ ...base, desire: "d".repeat(801) }).success).toBe(false);
    expect(AgentTurnSchema.safeParse({ ...base, action: { type: "respond", content: "c".repeat(6_001) } }).success).toBe(false);
    expect(AgentTurnSchema.safeParse({ ...base, action: { type: "no-external-action", reason: "r".repeat(801) } }).success).toBe(false);
    expect(AgentTurnSchema.safeParse({ ...base, patch: { mood: "m".repeat(161) } }).success).toBe(false);
    expect(AgentTurnSchema.safeParse({ ...base, patch: { concern: { operation: "upsert", concern: { id: "c", description: "d".repeat(801), whyItMatters: "理由", status: "active" } } } }).success).toBe(false);
    expect(AgentTurnSchema.safeParse({ ...base, patch: { relationship: { operation: "upsert", relationship: { subjectId: "user", description: "d".repeat(801) } } } }).success).toBe(false);
    expect(AgentTurnSchema.safeParse({ ...base, patch: { remember: "m".repeat(801) } }).success).toBe(false);
  });

  it("bounds Event Meaning and Feeling without restricting Feeling to an enum", () => {
    expect(EventAssessmentSchema.safeParse({ meaning: "m".repeat(801), feeling: "嬉しい" }).success).toBe(false);
    expect(EventAssessmentSchema.safeParse({ meaning: "会話を再開する呼び掛け", feeling: "名付けにくいが心が少し弾む" }).success).toBe(true);
    expect(EventAssessmentSchema.safeParse({ feeling: "f".repeat(161) }).success).toBe(false);
    const properties = z.toJSONSchema(EventAssessmentSchema).properties as Record<string, Record<string, unknown>>;
    expect(properties.meaning).toMatchObject({ maxLength: 800 });
    expect(properties.feeling).toMatchObject({ maxLength: 160 });
    expect(properties.feeling?.description).toContain("例から選ぶ必要はない");
    expect(properties.feeling).not.toHaveProperty("enum");
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

  it("rejects removed legacy Self input", () => {
    const input = agentCoreInputFixture();
    expect(AgentCoreInputSchema.safeParse(input).success).toBe(true);
    expect(AgentCoreInputSchema.safeParse({ ...input, self: { id: input.run.agentId } }).success).toBe(false);
  });

});
