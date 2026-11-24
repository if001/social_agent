import { readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { MemoryReflectorOutputSchema, SelfMoodReflectorOutputSchema, type ReflectionInput } from "../../src/application/reflection.js";
import {
  MAX_REFLECTION_MODEL_INPUT_TOKENS,
  REFLECTION_MAX_MODEL_CALLS,
  REFLECTION_RECURSION_LIMIT,
  ReflectionModelOutputJsonSchema,
  ReflectionModelOutputSchema,
  StructuredReflectionModel,
  TargetStructuredReflectionModel,
  reflectionStructuredOutputRepairMessageFor,
  reflectionConcernContext,
  reflectionToolResultForModel,
  reflectionToolRunScope,
  reflectionSystemPrompt,
  targetedReflectionSystemPrompt,
  targetedReflectorRepairInput,
  type ReflectionInvoker
} from "../../src/infrastructure/agent/reflection-harness.js";
import { noopLogger } from "../../src/observability/logger.js";

const skill = (name: string) => readFileSync(join(process.cwd(), "skills", name, "SKILL.md"), "utf8");

const input: ReflectionInput = {
  reflectionId: "reflection-1",
  agentId: "agent-a",
  expectedVersion: 2,
  self: { identity: "Agent A", disposition: "丁寧に確かめる", selfStory: "対話から学んでいる", commitments: ["約束を守る"] },
  state: { mood: "落ち着いている", concerns: [], relationships: [{ subjectId: "user", description: "率直に話せる" }] },
  events: [{ id: "event-1", occurredAt: "2026-01-01T00:00:00Z", summary: "約束を果たした" }],
  memories: [{ id: "memory-1", summary: "約束を果たした", significance: "信頼が深まった", subjects: ["user"], occurredAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:01:00Z" }]
};

describe("structured Reflection model", () => {
  it("FR-41, FR-60: bounds Concern Reflector input to active lifecycle candidates", () => {
    const concerns = Array.from({ length: 100 }, (_, index) => ({
      id: `concern-${String(index)}`,
      description: `継続中のConcern ${String(index)} ${"本文".repeat(80)}`,
      whyItMatters: `理由 ${"根拠".repeat(80)}`,
      status: "active" as const,
    }));
    const context = reflectionConcernContext({ ...input, state: { ...input.state, concerns: [...concerns, { id: "satisfied", description: "完了", whyItMatters: "完了した", status: "satisfied" }] } }, new Date("2026-01-01T00:00:00.000Z"));

    expect(context.stats).toMatchObject({ total: 101, active: 100, selected: 16, memorySelected: 1 });
    expect(context.concerns).toHaveLength(16);
    expect(context.concerns[0]?.description).toContain("Concern 0");
    expect(JSON.stringify(context.concerns)).not.toContain("satisfied");
  });

  it("FR-41, FR-60: selects whole records within the fixed Concern input budget", () => {
    const long = "本文".repeat(8_000);
    const concerns = Array.from({ length: 16 }, (_, index) => ({ id: `long-${String(index)}`, description: long, whyItMatters: long, status: "active" as const }));
    const context = reflectionConcernContext({ ...input, state: { ...input.state, concerns } });
    expect(context.stats.estimatedContentTokens).toBeLessThanOrEqual(5_000);
    expect(context.concerns).toHaveLength(0);
    expect(context.stats).toMatchObject({ active: 16, selected: 0 });
    expect(context.concerns.every(({ description, whyItMatters }) => description === long && whyItMatters === long)).toBe(true);
  });
  it("FR-80: hides persistent IDs, local handles, and cursors from Reflection Tool results", () => {
    expect(reflectionToolResultForModel({ id: "event-1", content: "根拠", reconciliationAnchors: [{ id: "memory-1", summary: "監査専用" }], targetSnapshots: { concern: { state: "監査専用" } }, nested: { memoryId: "memory-1", cursor: "next", summary: "残す" } })).toEqual({ content: "根拠", nested: { summary: "残す" } });
  });
  it("FR-60: repairs a target Reflector against its own schema rather than the legacy combined Reflection schema", () => {
    const message = reflectionStructuredOutputRepairMessageFor("memory");
    expect(message).toContain("memories 配列だけ");
    expect(message).toContain("最大4件");
    expect(message).toContain("episodic / semantic / self-related / self-change / common-ground");
    expect(message).not.toContain("concernChanges");
  });

  it("FR-9, FR-41: keeps Self/Mood Reflector output to an enduring emotional stance", () => {
    expect(SelfMoodReflectorOutputSchema.safeParse({ mood: "少しせっかちで、期待が強まっている。" }).success).toBe(true);
    expect(SelfMoodReflectorOutputSchema.safeParse({ mood: "あ".repeat(121) }).success).toBe(false);
    for (const phrase of ["感情的構え", "固有名詞", "返答待ち", "Concern", "行動計画", "理由"]) {
      expect(targetedReflectionSystemPrompt("self-mood")).toContain(phrase);
    }
    for (const phrase of ["感情的構え", "一時的なFeeling", "計画", "待機"]) expect(skill("reflection-self-mood")).toContain(phrase);
  });

  it("FR-6, FR-41, FR-42: describes the complete Self and keeps its skill focused", () => {
    const schema = z.toJSONSchema(SelfMoodReflectorOutputSchema);
    const self = (schema.properties as Record<string, Record<string, unknown>>).self;
    const properties = self?.properties as Record<string, Record<string, unknown>>;
    expect(properties.commitments?.description).toContain("守りたいもの");
    expect(properties.commitments).toMatchObject({ maxItems: 12 });
    const text = skill("reflection-self-mood");
    expect(text).toContain("Scheduled Task");
    expect(text).toContain("Concern");
    expect(text).toContain("Desire");
  });

  it("FR-42: keeps the Relationship skill to durable current state only", () => {
    const text = skill("reflection-relationship");
    expect(text).toContain("現在の関係の型");
    expect(text).toContain("人物プロフィール");
    expect(text).toContain("Feeling");
  });

  it("FR-71: gives each Memory Event batch an independent stable tool idempotency scope", () => {
    const event = input.events[0];
    if (event === undefined) throw new Error("Reflection fixture Event is missing");
    const firstBatch = { ...input, events: [{ ...event, id: "event-1" }] };
    const secondBatch = { ...input, events: [{ ...event, id: "event-33" }] };

    expect(reflectionToolRunScope("memory", firstBatch)).toBe("reflection-1:memory:event-1");
    expect(reflectionToolRunScope("memory", firstBatch)).toBe(reflectionToolRunScope("memory", firstBatch));
    expect(reflectionToolRunScope("memory", secondBatch)).toBe("reflection-1:memory:event-33");
    expect(reflectionToolRunScope("memory", secondBatch)).not.toBe(reflectionToolRunScope("memory", firstBatch));
    expect(reflectionToolRunScope("concern", secondBatch)).toBe("reflection-1:concern");
  });

  it("FR-81: reserves the default 32-call session budget for evidence reads and final Reflector output", () => {
    expect(REFLECTION_MAX_MODEL_CALLS).toBe(32);
  });

  it("FR-60, NFR-3: keeps target-specific maintenance instructions in runtime Skills", () => {
    expect(skill("reflection-memory")).toContain("Memoryだけを扱う");
    expect(skill("reflection-concern")).toContain("局所参照は出力しない");
    expect(skill("reflection-relationship")).toContain("Relationship");
    expect(skill("reflection-self-mood")).toContain("SelfとMood");
    expect(skill("reflection-memory")).toContain("構造化出力Toolを必ず1回");
    expect(skill("reflection-memory")).toContain('{"memories":[]}');
    expect(skill("reflection-memory")).toContain("既存Memoryを更新しない");
    expect(skill("reflection-memory")).toContain("self`や`user`は`perspective`");
    expect(skill("reflection-memory")).toContain("最大4件");
    expect(skill("reflection-memory")).toContain("Event ID、subject ID、局所参照は絶対に出力しない");
  });

  it("FR-71: gives a Formation Reflector only its bounded Event batch, not existing Memory bodies", async () => {
    const seen: string[] = [];
    const invoker: ReflectionInvoker = { invoke: (messages) => { seen.push(messages[0]?.content ?? ""); return Promise.resolve({ structuredResponse: { memories: [] } }); } };
    await new TargetStructuredReflectionModel(invoker, invoker, MemoryReflectorOutputSchema, "formation", noopLogger)
      .reflect({ reflectionId: "reflection-1", events: input.events }, new AbortController().signal, input.agentId, input.reflectionId);
    expect(seen[0]).not.toContain("memory-1");
  });

  it("FR-42, FR-65: retries a target Reflector with the original scoped input and no read invoker", async () => {
    const firstMessages: string[] = [];
    const repairMessages: string[] = [];
    const first: ReflectionInvoker = { invoke: (messages) => { firstMessages.push(messages[0]?.content ?? ""); return Promise.resolve({}); } };
    const repair: ReflectionInvoker = { invoke: (messages) => { repairMessages.push(messages[0]?.content ?? ""); return Promise.resolve({ structuredResponse: { memories: [] } }); } };
    const scoped = { events: input.events.map(({ occurredAt, summary }) => ({ occurredAt, summary })), memories: input.memories.map(({ summary, significance, occurredAt }) => ({ summary, significance, occurredAt })) };

    await expect(new TargetStructuredReflectionModel(first, repair, MemoryReflectorOutputSchema, "memory prompt", noopLogger).reflect(scoped, new AbortController().signal, input.agentId, input.reflectionId)).resolves.toEqual({ output: { memories: [] }, toolExecutions: [] });

    expect(firstMessages).toHaveLength(1);
    expect(repairMessages).toHaveLength(1);
    const payload = JSON.parse(repairMessages[0] ?? "{}") as Record<string, unknown>;
    expect(payload.input).toEqual(scoped);
    expect(payload).not.toHaveProperty("allowedEventIds");
    expect(payload).not.toHaveProperty("allowedMemoryIds");
    expect(payload.outputSchema).toBeDefined();
    expect(payload.validationIssues).toEqual([{ code: "custom", path: [], message: "Reflector returned no structured output after its Tool loop" }]);
    expect(payload.invalidOutput).toBeNull();
  });

  it("FR-42, NFR-7: repairs five Memory candidates into the schema maximum of four", async () => {
    const memory = (index: number) => ({
      content: `今後も使う経験 ${String(index)}`,
      reason: `判断に再利用する理由 ${String(index)}`,
      target: "semantic",
      perspective: "self"
    });
    const first: ReflectionInvoker = { invoke: () => Promise.resolve({ structuredResponse: { memories: [1, 2, 3, 4, 5].map(memory) } }) };
    const repair: ReflectionInvoker = { invoke: () => Promise.resolve({ structuredResponse: { memories: [1, 2, 3, 4].map(memory) } }) };

    const result = await new TargetStructuredReflectionModel(first, repair, MemoryReflectorOutputSchema, "memory prompt", noopLogger)
      .reflect({ reflectionId: input.reflectionId, events: input.events }, new AbortController().signal, input.agentId, input.reflectionId);

    expect((result.output as { memories: unknown[] }).memories).toHaveLength(4);
  });

  it("FR-42, FR-77: includes fixed input, schema, and validation details without record IDs in a repair payload", () => {
    const payload = targetedReflectorRepairInput({ events: [{ id: "event-1" }], memories: [{ id: "memory-1" }] }, MemoryReflectorOutputSchema, [{ path: ["memories"] }], { unexpected: true, echoed: { memoryId: "memory-1", evidenceEventIds: ["event-1"] } });
    expect(payload).toMatchObject({ validationIssues: [{ path: ["memories"] }], invalidOutput: { unexpected: true } });
    expect(JSON.stringify(payload)).not.toContain("memory-1");
    expect(JSON.stringify(payload)).not.toContain("event-1");
    expect(payload).not.toHaveProperty("allowedEventIds");
    expect(payload).not.toHaveProperty("allowedMemoryIds");
  });

  it("FR-42: repairs an invalid first output and converts flat changes to the strict Domain output", async () => {
    const prompts: string[] = [];
    const recursionLimits: number[] = [];
    const outputs: unknown[] = [
      { reflectionId: "reflection-1", agentId: "agent-a", expectedVersion: 2 },
      {
        memories: [],
        concernChanges: [{ operation: "upsert", id: "concern-1", description: "約束を続ける", whyItMatters: "信頼に関わる", status: "active" }],
        relationshipChanges: [{ operation: "upsert", currentDescription: "率直に話せる", description: "約束を守り合う関係" }],
        mood: "静かな達成感がある",
        evidenceMemoryIds: []
      }
    ];
    const invoker: ReflectionInvoker = { invoke: (messages, options) => {
      prompts.push(messages[0]?.content ?? "");
      recursionLimits.push(options.recursionLimit);
      return Promise.resolve({ structuredResponse: outputs.shift() });
    } };

    const result = await new StructuredReflectionModel(invoker).reflect(input, new AbortController().signal);

    expect(prompts).toHaveLength(2);
    expect(recursionLimits).toEqual([REFLECTION_RECURSION_LIMIT, REFLECTION_RECURSION_LIMIT]);
    expect(prompts[1]).toContain("validationIssues");
    expect(prompts[1]).toContain("invalidOutput");
    expect(result).toMatchObject({
      concernChanges: [{ operation: "upsert", concern: { id: "concern-1", status: "active" } }],
      relationshipChanges: [{ operation: "upsert", relationship: { subjectId: "user" } }],
      mood: "静かな達成感がある"
    });
  });

  it("FR-25, FR-44: rejects a create Concern from the legacy combined Reflection path", async () => {
    await expect(new StructuredReflectionModel({ invoke: () => Promise.resolve({ structuredResponse: {
      memories: [],
      concernChanges: [{ operation: "create", description: "新しい設計意図を確かめる", whyItMatters: "探索役としての役割に関わる" }],
      relationshipChanges: [],
      evidenceMemoryIds: ["memory-1"]
    } }) }).reflect(input, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("FR-42: fails without a valid commit value after the configured repair", async () => {
    let calls = 0;
    const model = new StructuredReflectionModel({ invoke: () => {
      calls += 1;
      return Promise.resolve({ structuredResponse: { action: "not-a-reflection" } });
    } });
    await expect(model.reflect(input, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(calls).toBe(2);
  });

  it("FR-42: rejects incomplete Self updates, non-ISO timestamps, and overlong Concerns before domain conversion", () => {
    const base = { memories: [], concernChanges: [], relationshipChanges: [], evidenceMemoryIds: [] };
    expect(ReflectionModelOutputSchema.safeParse({ ...base, selfChangeReason: "理由だけ" }).success).toBe(false);
    expect(ReflectionModelOutputSchema.safeParse({ ...base, memories: [{ summary: "経験", significance: "重要", subjects: [], occurredAt: "2026-01-01" }] }).success).toBe(false);
    expect(ReflectionModelOutputSchema.safeParse({ ...base, concernChanges: [{ operation: "create", description: "長".repeat(801), whyItMatters: "理由" }], evidenceMemoryIds: ["memory-1"] }).success).toBe(false);
  });

  it("FR-42: logs schema paths without logging the invalid output value", async () => {
    const logs: { readonly step: string; readonly context?: Readonly<Record<string, string | number | boolean | null | undefined>> }[] = [];
    const logger = { child: () => logger, log: (_level: string, step: string, context?: Readonly<Record<string, string | number | boolean | null | undefined>>) => { logs.push({ step, ...(context === undefined ? {} : { context }) }); } };
    const model = new StructuredReflectionModel({ invoke: () => Promise.resolve({ structuredResponse: { memories: [], concernChanges: [], relationshipChanges: [], evidenceMemoryIds: [], selfChangeReason: "理由だけ" } }) }, logger, 0);
    await expect(model.reflect(input, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(logs.find(({ step }) => step === "reflection.output_invalid")?.context?.validationIssues).toContain("selfChangeReason");
  });

  it("FR-42: describes every model-facing property and removes provider-only regex constraints", () => {
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
    expect(properties.concernChanges?.description).toContain("気に掛けていること");
    expect(properties.relationshipChanges?.description).toContain("関係が変わらなければ");
    expect(properties.mood?.description).toContain("次の複数Event");
    expect(properties.mood).toMatchObject({ maxLength: 120 });
    expect(properties.mood?.description).toContain("行動計画");
    expect(properties.selfDisposition?.description).toContain("意味づけの傾向");
    expect(properties.evidenceMemoryIds?.description).toContain("Runtimeが検証");
    expect(reflectionSystemPrompt).toContain("空のmaintenance結果は正しい");
    expect(reflectionSystemPrompt).toContain("新規Concernの作成");
    expect(reflectionSystemPrompt).toContain("入力Eventを網羅的に要約しない");
  });

  it("FR-42, NFR-4: rejects an oversized Reflection prompt before invoking the model", async () => {
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
