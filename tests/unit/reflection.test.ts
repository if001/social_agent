import { Reflection, ReflectionOutputSchema, TargetedReflection, type ReflectionInput, type ReflectionOutput } from "../../src/application/reflection.js";

const input: ReflectionInput = {
  reflectionId: "reflection-1", agentId: "agent-a", expectedVersion: 2,
  self: { identity: "Agent A", disposition: "丁寧に確かめる", selfStory: "対話から学んでいる", commitments: ["約束を守る"] },
  state: { concerns: [], relationships: [] },
  events: [{ id: "event-1", occurredAt: "2026-01-01T00:00:00Z", summary: "約束を果たした" }],
  memories: [{ id: "memory-1", summary: "約束を果たした", significance: "信頼が深まった", subjects: ["user"], occurredAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:01:00Z" }]
};

describe("Reflection", () => {
  it("FR-41, FR-60: executes target Reflectors in dependency order and blocks downstream targets after Memory fails", async () => {
    const calls: string[] = [];
    const statuses: string[] = [];
    const reflection = new TargetedReflection({
      load: () => Promise.resolve(input),
      refresh: (value) => Promise.resolve(value),
      beginTarget: (_input, target) => { statuses.push(`begin:${target}`); return Promise.resolve("pending"); },
      commitTarget: (_input, target) => { statuses.push(`completed:${target}`); return Promise.resolve(); },
      failTarget: (_input, target, error) => { statuses.push(`failed:${target}:${error instanceof Error ? error.message : "unknown"}`); return Promise.resolve(); },
      blockTarget: (_input, target) => { statuses.push(`blocked:${target}`); return Promise.resolve(); },
      complete: () => Promise.resolve(),
      fail: () => Promise.resolve()
    }, {
      reflect: (target) => {
        calls.push(target);
        if (target === "memory") return Promise.reject(new Error("memory unavailable"));
        return Promise.resolve({ output: {}, toolExecutions: [] });
      }
    });
    await reflection.process("reflection-1", "agent-a", new AbortController().signal);
    expect(calls).toEqual(["memory"]);
    expect(statuses).toEqual(["begin:memory", "failed:memory:memory unavailable", "blocked:concern", "blocked:relationship", "blocked:self-mood"]);
  });

  it("FR-42, FR-60: skips completed targets when a pending Session retries only its failed Concern", async () => {
    const calls: string[] = [];
    const refreshed: string[] = [];
    const reflection = new TargetedReflection({
      load: () => Promise.resolve(input),
      refresh: (value) => { refreshed.push(value.reflectionId); return Promise.resolve(value); },
      beginTarget: (_input, target) => Promise.resolve(target === "memory" || target === "relationship" ? "completed" : "pending"),
      commitTarget: () => Promise.resolve(), failTarget: () => Promise.resolve(), blockTarget: () => Promise.resolve(), complete: () => Promise.resolve(), fail: () => Promise.resolve()
    }, { reflect: (target) => { calls.push(target); return Promise.resolve({ output: target === "concern" ? { concernChanges: [], evidenceMemoryIds: [] } : { mood: "落ち着いている", evidenceMemoryIds: [] }, toolExecutions: [] }); } });
    await reflection.process("reflection-1", "agent-a", new AbortController().signal);
    expect(calls).toEqual(["concern", "self-mood"]);
    expect(refreshed).toEqual(["reflection-1", "reflection-1", "reflection-1", "reflection-1"]);
  });

  it("FR-44, FR-60: passes Memory committed in this Session to a later Concern Reflector", async () => {
    const committedMemory = { id: "memory-created", summary: "新しく確定した経験", significance: "次の関心の根拠", subjects: ["user"], occurredAt: "2026-01-01T00:02:00Z", createdAt: "2026-01-01T00:02:00Z" };
    const concernInputs: ReflectionInput[] = [];
    const reflection = new TargetedReflection({
      load: () => Promise.resolve(input),
      refresh: (value) => Promise.resolve({ ...value, memories: [...value.memories, committedMemory] }),
      beginTarget: () => Promise.resolve("pending"), commitTarget: () => Promise.resolve(), failTarget: () => Promise.resolve(), blockTarget: () => Promise.resolve(), complete: () => Promise.resolve(), fail: () => Promise.resolve()
    }, {
      reflect: (target, value) => {
        if (target === "memory") return Promise.resolve({ output: { memories: [{ summary: committedMemory.summary, significance: committedMemory.significance, subjects: committedMemory.subjects, occurredAt: committedMemory.occurredAt }] }, toolExecutions: [] });
        if (target === "concern") { concernInputs.push(value); return Promise.resolve({ output: { concernChanges: [{ operation: "create", concern: { description: "新しい関心", whyItMatters: "経験に由来する", status: "active" } }], evidenceMemoryIds: [committedMemory.id] }, toolExecutions: [] }); }
        if (target === "relationship") return Promise.resolve({ output: { relationshipChanges: [] }, toolExecutions: [] });
        return Promise.resolve({ output: { evidenceMemoryIds: [] }, toolExecutions: [] });
      }
    });
    await reflection.process("reflection-1", "agent-a", new AbortController().signal);
    expect(concernInputs[0]?.memories.map(({ id }) => id)).toContain("memory-created");
  });
  it("FR-41: commits one maintenance result and treats a duplicate commit as success", async () => {
    const output: ReflectionOutput = { memories: [], concernChanges: [], relationshipChanges: [], evidenceMemoryIds: [] };
    const commits: ReflectionOutput[] = [];
    const reflection = new Reflection({ load: () => Promise.resolve(input), commit: (_input, value) => { commits.push(value); return Promise.resolve("duplicate"); }, fail: () => Promise.resolve() }, { reflect: () => Promise.resolve(output) });
    await expect(reflection.process("reflection-1", "agent-a", new AbortController().signal)).resolves.toEqual(output);
    expect(commits).toEqual([output]);
  });

  it("FR-41, NFR-2: requires grounded evidence for a Self change", () => {
    expect(ReflectionOutputSchema.safeParse({ memories: [], concernChanges: [], relationshipChanges: [], self: input.self, selfChangeReason: "一度の経験", evidenceMemoryIds: [] }).success).toBe(false);
    expect(ReflectionOutputSchema.safeParse({ memories: [], concernChanges: [], relationshipChanges: [], self: { ...input.self, selfStory: "約束を重ねて信頼を育てている" }, selfChangeReason: "反復した経験", evidenceMemoryIds: ["memory-1"] }).success).toBe(true);
  });

  it("NFR-1, NFR-2: rejects evidence outside the loaded Agent context and records failure", async () => {
    const failures: unknown[] = [];
    const reflection = new Reflection({ load: () => Promise.resolve(input), commit: () => Promise.resolve("committed"), fail: (_input, error) => { failures.push(error); return Promise.resolve(); } }, { reflect: () => Promise.resolve({ memories: [], concernChanges: [], relationshipChanges: [], self: input.self, selfChangeReason: "反復した経験", evidenceMemoryIds: ["foreign-memory"] }) });
    await expect(reflection.process("reflection-1", "agent-a", new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(failures).toHaveLength(1);
  });

  it("FR-25, FR-41, FR-44, AC-6: accepts a grounded new Concern during Reflection", async () => {
    const output: ReflectionOutput = { memories: [], concernChanges: [{ operation: "create", concern: { description: "新しい対象を調べる", whyItMatters: "知りたいため", status: "active" } }], relationshipChanges: [], evidenceMemoryIds: ["memory-1"] };
    const commits: ReflectionOutput[] = [];
    const reflection = new Reflection({ load: () => Promise.resolve(input), commit: (_input, value) => { commits.push(value); return Promise.resolve("committed"); }, fail: () => Promise.resolve() }, { reflect: () => Promise.resolve(output) });
    await expect(reflection.process("reflection-1", "agent-a", new AbortController().signal)).resolves.toEqual(output);
    expect(commits).toEqual([output]);
  });

  it("FR-25, FR-44: requires evidence and required fields for a new Concern", () => {
    expect(ReflectionOutputSchema.safeParse({ memories: [], concernChanges: [{ operation: "create", concern: { description: "新しい対象を調べる", whyItMatters: "知りたいため", status: "active" } }], relationshipChanges: [], evidenceMemoryIds: [] }).success).toBe(false);
    expect(ReflectionOutputSchema.safeParse({ memories: [], concernChanges: [{ operation: "create", concern: { description: "新しい対象を調べる", status: "active" } }], relationshipChanges: [], evidenceMemoryIds: ["memory-1"] }).success).toBe(false);
    expect(ReflectionOutputSchema.safeParse({ memories: [], concernChanges: [{ operation: "create", concern: { description: "新しい対象を調べる", whyItMatters: "知りたいため", status: "satisfied" } }], relationshipChanges: [], evidenceMemoryIds: ["memory-1"] }).success).toBe(false);
  });

  it("FR-25, FR-44: limits Reflection to three new Concerns per run", () => {
    const create = (index: number) => ({ operation: "create" as const, concern: { description: `新しい対象${String(index)}`, whyItMatters: "知りたいため", status: "active" as const } });
    expect(ReflectionOutputSchema.safeParse({ memories: [], concernChanges: [create(1), create(2), create(3), create(4)], relationshipChanges: [], evidenceMemoryIds: ["memory-1"] }).success).toBe(false);
    expect(ReflectionOutputSchema.safeParse({ memories: [], concernChanges: [create(1), create(2), create(3)], relationshipChanges: [], evidenceMemoryIds: ["memory-1"] }).success).toBe(true);
  });

  it("FR-25, FR-44: rejects upsert of an unknown existing Concern", async () => {
    const reflection = new Reflection({ load: () => Promise.resolve(input), commit: () => Promise.resolve("committed"), fail: () => Promise.resolve() }, { reflect: () => Promise.resolve({ memories: [], concernChanges: [{ operation: "upsert", concern: { id: "new-concern", description: "新しい対象を調べる", whyItMatters: "知りたいため", status: "active" } }], relationshipChanges: [], evidenceMemoryIds: [] }) });
    await expect(reflection.process("reflection-1", "agent-a", new AbortController().signal)).rejects.toThrow("unknown Concern");
  });
});
