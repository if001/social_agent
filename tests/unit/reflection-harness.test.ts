import type { ReflectionInput } from "../../src/application/reflection.js";
import {
  MAX_REFLECTION_MODEL_INPUT_TOKENS,
  ReflectionModelOutputJsonSchema,
  StructuredReflectionModel,
  reflectionSystemPrompt,
  type ReflectionInvoker
} from "../../src/infrastructure/agent/reflection-harness.js";

const input: ReflectionInput = {
  reflectionId: "reflection-1",
  agentId: "agent-a",
  expectedVersion: 2,
  self: { identity: "Agent A", disposition: "丁寧に確かめる", selfStory: "対話から学んでいる", commitments: ["約束を守る"] },
  state: { mood: "落ち着いている", concerns: [], relationships: [] },
  events: [{ id: "event-1", occurredAt: "2026-01-01T00:00:00Z", summary: "約束を果たした" }],
  memories: [{ id: "memory-1", summary: "約束を果たした", significance: "信頼が深まった", subjects: ["user"], occurredAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:01:00Z" }]
};

describe("structured Reflection model", () => {
  it("repairs an invalid first output and converts flat changes to the strict Domain output", async () => {
    const prompts: string[] = [];
    const outputs: unknown[] = [
      { reflectionId: "reflection-1", agentId: "agent-a", expectedVersion: 2 },
      {
        memories: [],
        concernChanges: [{ operation: "upsert", id: "concern-1", description: "約束を続ける", whyItMatters: "信頼に関わる", status: "active" }],
        relationshipChanges: [{ operation: "upsert", subjectId: "user", description: "約束を守り合う関係" }],
        mood: "静かな達成感がある",
        evidenceMemoryIds: []
      }
    ];
    const invoker: ReflectionInvoker = { invoke: (messages) => {
      prompts.push(messages[0]?.content ?? "");
      return Promise.resolve({ structuredResponse: outputs.shift() });
    } };

    const result = await new StructuredReflectionModel(invoker).reflect(input, new AbortController().signal);

    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("validationIssues");
    expect(prompts[1]).toContain("invalidOutput");
    expect(result).toMatchObject({
      concernChanges: [{ operation: "upsert", concern: { id: "concern-1", status: "active" } }],
      relationshipChanges: [{ operation: "upsert", relationship: { subjectId: "user" } }],
      mood: "静かな達成感がある"
    });
  });

  it("fails without a valid commit value after the configured repair", async () => {
    let calls = 0;
    const model = new StructuredReflectionModel({ invoke: () => {
      calls += 1;
      return Promise.resolve({ structuredResponse: { action: "not-a-reflection" } });
    } });
    await expect(model.reflect(input, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(calls).toBe(2);
  });

  it("describes every model-facing property and removes provider-only regex constraints", () => {
    const missing: string[] = [];
    const visit = (value: unknown, path: string): void => {
      if (typeof value !== "object" || value === null) return;
      const object = value as Record<string, unknown>;
      if (typeof object.properties === "object" && object.properties !== null) {
        for (const [name, property] of Object.entries(object.properties as Record<string, unknown>)) {
          if (typeof property !== "object" || property === null || typeof (property as Record<string, unknown>).description !== "string") missing.push(path + name);
          visit(property, path + name + ".");
        }
      }
      if (object.items !== undefined) visit(object.items, path + "[]");
      if (typeof object.$defs === "object" && object.$defs !== null) for (const [name, definition] of Object.entries(object.$defs as Record<string, unknown>)) visit(definition, path + name + ".");
    };
    visit(ReflectionModelOutputJsonSchema, "");
    expect(missing).toEqual([]);
    expect(JSON.stringify(ReflectionModelOutputJsonSchema)).not.toContain('"pattern":');
    const properties = ReflectionModelOutputJsonSchema.properties as Record<string, Record<string, unknown>>;
    expect(properties.memories?.description).toContain("Context検索");
    expect(properties.concernChanges?.description).toContain("未解決事項");
    expect(properties.relationshipChanges?.description).toContain("関係が変わらなければ");
    expect(properties.mood?.description).toContain("次の複数Event");
    expect(properties.mood).toMatchObject({ maxLength: 160 });
    expect(properties.mood?.description).toContain("願望、計画は書かない");
    expect(properties.selfDisposition?.description).toContain("意味づけの傾向");
    expect(properties.evidenceMemoryIds?.description).toContain("Runtimeが検証");
    expect(reflectionSystemPrompt).toContain("空のmaintenance結果は正しい");
    expect(reflectionSystemPrompt).toContain("入力Eventを網羅的に要約しない");
  });

  it("rejects an oversized Reflection prompt before invoking the model", async () => {
    let invoked = false;
    const model = new StructuredReflectionModel({ invoke: () => { invoked = true; return Promise.resolve({}); } });
    const oversized: ReflectionInput = {
      ...input,
      events: Array.from({ length: 32 }, (_, index) => ({ id: `event-${String(index)}`, occurredAt: "2026-01-01T00:00:00Z", summary: "長".repeat(16_000) }))
    };
    const error = await model.reflect(oversized, new AbortController().signal).catch((reason: unknown) => reason);
    expect(error).toMatchObject({ code: "LIMIT_EXCEEDED" });
    expect(error).toBeInstanceOf(Error);
    if (error instanceof Error) expect(error.message).toContain(String(MAX_REFLECTION_MODEL_INPUT_TOKENS));
    expect(invoked).toBe(false);
  });
});
