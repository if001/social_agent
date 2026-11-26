import { z } from "zod";
import { AgentActionSchema, AgentCoreInputSchema, AgentStateSchema, AgentTurnSchema, ConcernActivityIntentSchema, ConcernChangeSchema, ConcernProposalSchema, ConcernSchema, EpisodicMemorySchema, EventAssessmentSchema, initialSelfFromConfig, InitialSelfConfigSchema, MessageEnvelopeSchema, PersistedSelfSchema, SelfSchema } from "../../src/domain/contracts.js";
import { ConcernReflectorOutputSchema } from "../../src/application/reflection.js";
import { agentCoreInputFixture, messageFixture } from "../../src/testing/contract-fixtures.js";
import { modelObservationForAgentCore, observationFromEvent } from "../../src/infrastructure/persistence/postgres-agent-context-loader.js";

describe("domain contracts", () => {
  it("FR-77: keeps transport actor identity only in the audit observation", () => {
    const audit = observationFromEvent({ id: "event-peer", agentId: "shiro", kind: "message-received", occurredAt: "2026-01-01T00:00:00Z", payload: { text: "hello", senderKind: "peer", addressing: "observed", actorId: "discord-peer-id", actorType: "agent", peerName: "アカ", sourceType: "discord", sourceId: "discord-channel-id", subjectId: "agent:aka" } });
    const model = modelObservationForAgentCore(audit);
    expect(audit).toMatchObject({ actor: { id: "discord-peer-id" }, source: { id: "discord-channel-id" } });
    expect(model).not.toHaveProperty("actor"); expect(model.source).toEqual({ type: "discord", direct: false });
    expect(model.content).toEqual({ senderKind: "peer", addressing: "observed", peerName: "アカ" });
    expect(JSON.stringify(model)).not.toContain("discord-peer-id"); expect(JSON.stringify(model)).not.toContain("discord-channel-id"); expect(JSON.stringify(model)).not.toContain("agent:aka");
  });

  it("FR-17, FR-18, FR-19, FR-21, FR-92: represents every single-recipient action", () => {
    for (const action of [
      { type: "respond", content: "Hello" },
      { type: "respond", content: "それ、気になる", recipient: "channel" },
      { type: "refuse", content: "I can't help with that.", reason: "Unsafe", basis: "system" },
      { type: "notify-no-execution", content: "今回は実行しない", reason: "新しい手掛かりがない" },
      { type: "no-external-action", reason: "Nothing due" }
    ]) expect(AgentActionSchema.safeParse(action).success).toBe(true);
    expect(AgentActionSchema.safeParse({ type: "respond", content: "共有", peer: { name: "アカ", content: "返信" } }).success).toBe(false);
    expect(AgentActionSchema.safeParse({ type: "respond", content: "共有", recipient: "channel" }).success).toBe(true);
    expect(AgentActionSchema.safeParse({ type: "respond", content: "アカへ", recipient: "アカ" }).success).toBe(false);
    expect(AgentActionSchema.safeParse({ type: "refuse", reason: "private reason", basis: "personality" }).success).toBe(false);
    expect(AgentActionSchema.safeParse({ type: "tool", call: { id: "c", name: "web", input: {} } }).success).toBe(false);
    expect(AgentActionSchema.safeParse({ type: "wait", reason: "Later" }).success).toBe(false);
  });

  it("FR-6, FR-7, FR-10: defines the redesigned natural-language Self, State, Memory, Assessment and Turn", () => {
    expect(SelfSchema.parse({ identity: "探究する個体", disposition: "曖昧さを急いで埋めない", selfStory: "対話から学んできた", commitments: ["約束を守る"] })).toBeDefined();
    expect(AgentStateSchema.parse({ mood: { updatedAt: "2026-01-01T00:00:00.000Z", levels: {} }, concerns: [{ id: "c1", description: "関係を修復する", whyItMatters: "信頼を大切にしている", status: "active" }], relationships: [{ subjectId: "user", description: "率直に話せる相手" }] })).toBeDefined();
    expect(EpisodicMemorySchema.parse({ id: "m1", summary: "約束が破られた", significance: "信頼への懸念が生じた", subjects: ["user"], occurredAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:00:01Z" })).toBeDefined();
    expect(EventAssessmentSchema.parse({ meaning: "大切な約束が軽視された", feeling: [{ emotion: "anger", intensity: 4 }, { emotion: "sadness", intensity: 2 }] })).toBeDefined();
    expect(AgentTurnSchema.safeParse({ desire: "境界を伝えたい", action: { type: "notify-no-execution", content: "今回は待つ", reason: "材料不足" } }).success).toBe(true);
    expect(AgentTurnSchema.safeParse({ desire: "待つ", action: { type: "wait" } }).success).toBe(false);
  });

  it("FR-6: gives every Self field a distinct compact current-state contract", () => {
    const schema = z.toJSONSchema(SelfSchema);
    const properties = schema.properties as Record<string, Record<string, unknown>>;
    expect(properties.identity?.description).toContain("自分が誰であるか");
    expect(properties.disposition?.description).toContain("価値を感じやすい");
    expect(properties.selfStory?.description).toContain("現在の自己理解");
    expect(properties.commitments?.description).toContain("守りたいもの");
    expect(properties.commitments).toMatchObject({ maxItems: 12 });
    expect(properties.commitments?.items).toMatchObject({ maxLength: 400 });
    expect(SelfSchema.safeParse({ identity: "探究する個体", disposition: "曖昧さを急いで埋めない", selfStory: "対話から学んできた", commitments: Array.from({ length: 13 }, () => "約束を守る") }).success).toBe(false);
    expect(SelfSchema.safeParse({ identity: "探究する個体", disposition: "曖昧さを急いで埋めない", selfStory: "対話から学んできた", commitments: ["あ".repeat(401)] }).success).toBe(false);
  });

  it("FR-6: keeps legacy persisted Self readable while enforcing the bounded writer contract", () => {
    const legacy = { identity: "探究する個体", disposition: "曖昧さを急いで埋めない", selfStory: "対話から学んできた", commitments: Array.from({ length: 13 }, () => "あ".repeat(401)) };
    expect(PersistedSelfSchema.safeParse(legacy).success).toBe(true);
    expect(SelfSchema.safeParse(legacy).success).toBe(false);
    const input = agentCoreInputFixture();
    expect(AgentCoreInputSchema.safeParse({ ...input, currentSelf: { ...input.currentSelf, ...legacy } }).success).toBe(true);
  });

  it("FR-6: applies the writer contract when initial configuration becomes Self", () => {
    const config = InitialSelfConfigSchema.parse({
      version: 1,
      family: { id: "family", name: "family", sharedDisposition: "共通の傾向" },
      agent: { id: "agent", identity: "Agent", initialDisposition: "初期傾向", raisonDetre: "守るもの", selfNarrative: "自己理解", selfContinuity: "継続性" }
    });
    expect(initialSelfFromConfig(config)).toMatchObject({ commitments: ["守るもの"], selfStory: "自己理解\n継続性" });
    expect(() => initialSelfFromConfig(InitialSelfConfigSchema.parse({ ...config, agent: { ...config.agent, raisonDetre: "あ".repeat(401) } }))).toThrow();
    expect(() => initialSelfFromConfig(InitialSelfConfigSchema.parse({ ...config, agent: { ...config.agent, selfNarrative: "あ".repeat(400), selfContinuity: "い".repeat(400) } }))).toThrow();
  });

  it("FR-8: keeps legacy Concern readable while bounding every model-facing Concern writer", () => {
    const legacy = { id: "c1", description: "d".repeat(1_000), whyItMatters: "w".repeat(1_000), status: "active" as const };
    expect(ConcernSchema.safeParse(legacy).success).toBe(true);
    expect(ConcernProposalSchema.safeParse({ operation: "create", description: "d".repeat(401), whyItMatters: "理由" }).success).toBe(false);
    expect(ConcernProposalSchema.safeParse({ operation: "create", description: "関心", whyItMatters: "w".repeat(301) }).success).toBe(false);
    expect(ConcernProposalSchema.safeParse({ operation: "derive", description: "関心", whyItMatters: "理由" }).success).toBe(false);
    expect(ConcernProposalSchema.safeParse({ operation: "derive", description: "関心", whyItMatters: "理由", derivationReason: "新しい経験が別の関心を生んだ" }).success).toBe(true);
    expect(ConcernProposalSchema.safeParse({ operation: "create", description: "関心", whyItMatters: "理由", derivationReason: "不要" }).success).toBe(false);
    expect(ConcernChangeSchema.safeParse({ operation: "create", concern: { description: "d".repeat(401), whyItMatters: "理由", status: "active" } }).success).toBe(false);
    expect(ConcernReflectorOutputSchema.safeParse({ concernChanges: [{ operation: "create", description: "新しい関心", whyItMatters: "理由" }] }).success).toBe(false);
    expect(ConcernReflectorOutputSchema.safeParse({ concernChanges: [{ operation: "upsert", currentDescription: legacy.description, description: "d".repeat(401), whyItMatters: "理由", status: "active" }] }).success).toBe(false);
    expect(ConcernReflectorOutputSchema.safeParse({ concernChanges: [{ operation: "upsert", currentDescription: legacy.description, description: "関心", whyItMatters: "理由", status: "active" }] }).success).toBe(true);
  });

  it("FR-69, NFR-7: permits lineage audit fields only on derived Concern Activity", () => {
    expect(ConcernActivityIntentSchema.safeParse({ concernId: "child", kind: "derived", eventId: "event", sourceConcernId: "parent", reason: "新しい経験で別の関心が残った", evidenceMemoryIds: ["memory"] }).success).toBe(true);
    expect(ConcernActivityIntentSchema.safeParse({ concernId: "created", kind: "created", eventId: "event", sourceConcernId: "parent" }).success).toBe(false);
    expect(ConcernActivityIntentSchema.safeParse({ concernId: "derived", kind: "derived", eventId: "event", sourceConcernId: "parent", reason: "理由だけ" }).success).toBe(false);
  });

  it("FR-23: bounds generated Agent Core text by each field's purpose", () => {
    const base = { desire: "具体的に話したい", action: { type: "respond" as const, content: "返答" } };
    expect(AgentTurnSchema.safeParse({ ...base, desire: "d".repeat(801) }).success).toBe(false);
    expect(AgentTurnSchema.safeParse({ ...base, action: { type: "respond", content: "c".repeat(6_001) } }).success).toBe(false);
    expect(AgentTurnSchema.safeParse({ ...base, action: { type: "no-external-action", reason: "r".repeat(801) } }).success).toBe(false);
    expect(AgentTurnSchema.safeParse({ ...base, patch: { concern: { operation: "upsert", concern: { id: "c", description: "d".repeat(801), whyItMatters: "理由", status: "active" } } } }).success).toBe(false);
    expect(AgentTurnSchema.safeParse({ ...base, patch: { relationship: { operation: "upsert", relationship: { subjectId: "user", description: "d".repeat(801) } } } }).success).toBe(false);
    expect(AgentTurnSchema.safeParse({ ...base, patch: { remember: { content: "m".repeat(801), perspective: "user", purpose: "user-context" } } }).success).toBe(false);
  });

  it("FR-3, FR-9: bounds Event Meaning and Feeling to named affects with intensity", () => {
    expect(EventAssessmentSchema.safeParse({ meaning: "m".repeat(801), feeling: [{ emotion: "joy", intensity: 3 }] }).success).toBe(false);
    expect(EventAssessmentSchema.safeParse({ meaning: "会話を再開する呼び掛け", feeling: [{ emotion: "joy", intensity: 2 }] }).success).toBe(true);
    expect(EventAssessmentSchema.safeParse({ feeling: [{ emotion: "joy", intensity: 6 }] }).success).toBe(false);
    expect(EventAssessmentSchema.safeParse({ feeling: [{ emotion: "joy", intensity: 2 }, { emotion: "joy", intensity: 3 }] }).success).toBe(false);
    const properties = z.toJSONSchema(EventAssessmentSchema).properties as Record<string, Record<string, unknown>>;
    expect(properties.meaning).toMatchObject({ maxLength: 800 });
    expect(properties.feeling).toMatchObject({ minItems: 1, maxItems: 3, type: "array" });
    expect(properties.feeling?.description).toContain("感情カテゴリ");
  });

  it("FR-9: gives new Agents an empty affect vector", () => {
    expect(InitialSelfConfigSchema.shape.initialState.parse({}).mood).toEqual({});
  });

  it("FR-1, FR-3: maps every Event kind to an objective, provenance-aware Observation", () => {
    for (const kind of ["message-received", "user-message", "tool-result", "time", "external", "internal", "system"] as const) {
      const observation = observationFromEvent({ id: `event-${kind}`, agentId: "a", kind, occurredAt: "2026-01-01T00:00:00Z", payload: { text: "reported fact", actorId: "actor", actorType: kind === "external" ? "agent" : "human", sourceType: kind === "external" ? "agent" : "terminal", provenance: { channel: "test" } }, causationId: "cause", correlationId: "correlation" });
      expect(observation).toMatchObject({ kind, actor: { id: "actor" }, causationId: "cause", correlationId: "correlation", content: { text: "reported fact" } });
      expect(observation.source?.direct).toBe(kind !== "external" && kind !== "tool-result");
    }
  });

  it("NFR-1, NFR-10: rejects hop, attempt, TTL and ownership violations", () => {
    expect(MessageEnvelopeSchema.safeParse(messageFixture({ hop: 33 })).success).toBe(false);
    expect(MessageEnvelopeSchema.safeParse(messageFixture({ attempt: 33 })).success).toBe(false);
    expect(MessageEnvelopeSchema.safeParse(messageFixture({ expiresAt: "2025-01-01T00:00:00Z" })).success).toBe(false);
    const input = agentCoreInputFixture();
    expect(AgentCoreInputSchema.safeParse({ ...input, memories: [{ id: "m", agentId: "agent-b", kind: "episodic", content: "Other experience", occurredAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-02T00:00:00Z", relatedSubjectIds: [], importance: "Relevant", evidenceEventIds: [] }] }).success).toBe(false);
  });

  it("FR-5, FR-6: rejects removed legacy Self input", () => {
    const input = agentCoreInputFixture();
    expect(AgentCoreInputSchema.safeParse(input).success).toBe(true);
    expect(AgentCoreInputSchema.safeParse({ ...input, self: { id: input.run.agentId } }).success).toBe(false);
  });

});
