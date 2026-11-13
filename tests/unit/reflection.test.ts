import { MemoryReconciliationOutputSchema, MemoryReflectorOutputSchema, Reflection, ReflectionOutputSchema, TargetedReflection, type ReflectionInput, type ReflectionOutput } from "../../src/application/reflection.js";

const input: ReflectionInput = {
  reflectionId: "reflection-1", agentId: "agent-a", expectedVersion: 2,
  self: { identity: "Agent A", disposition: "丁寧に確かめる", selfStory: "対話から学んでいる", commitments: ["約束を守る"] },
  state: { concerns: [], relationships: [] },
  events: [{ id: "event-1", occurredAt: "2026-01-01T00:00:00Z", summary: "約束を果たした" }],
  memories: [{ id: "memory-1", summary: "約束を果たした", significance: "信頼が深まった", subjects: ["user"], occurredAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:01:00Z" }]
};

describe("Reflection", () => {
  it("C-10, FR-10: requires each Reflection Memory to select one to sixteen distinct evidence Events", () => {
    const memory = {
      content: "ユーザーは展示を訪れる予定を話した",
      reason: "次回に訪問できたか自然に尋ねるため",
      evidenceEventIds: ["event-1"],
      target: "episodic" as const,
      perspective: "user" as const,
      subjects: ["user"]
    };
    expect(MemoryReflectorOutputSchema.safeParse({ memories: [memory] }).success).toBe(true);
    expect(MemoryReflectorOutputSchema.safeParse({ memories: [{ ...memory, confidence: "high" }] }).success).toBe(false);
    expect(MemoryReflectorOutputSchema.safeParse({ memories: [{ ...memory, purpose: "user-context" }] }).success).toBe(false);
    expect(MemoryReflectorOutputSchema.safeParse({ memories: [{ ...memory, source: "agent-a" }] }).success).toBe(false);
    expect(MemoryReflectorOutputSchema.safeParse({ memories: [{ ...memory, target: "self" }] }).success).toBe(false);
    expect(MemoryReflectorOutputSchema.safeParse({ memories: [] }).success).toBe(true);
    expect(MemoryReflectorOutputSchema.safeParse({ memories: [{ ...memory, evidenceEventIds: [] }] }).success).toBe(false);
    expect(MemoryReflectorOutputSchema.safeParse({ memories: [{ ...memory, evidenceEventIds: Array.from({ length: 17 }, (_, index) => `event-${String(index)}`) }] }).success).toBe(false);
    expect(MemoryReflectorOutputSchema.safeParse({ memories: [{ ...memory, evidenceEventIds: ["event-1", "event-1"] }] }).success).toBe(false);
  });

  it("FR-73: requires direct Event evidence for a non-episodic reconciliation update and accepts keep", () => {
    expect(MemoryReconciliationOutputSchema.safeParse({ changes: [{ memoryId: "memory-1", operation: "keep", reason: "維持する", evidenceEventIds: [], evidenceMemoryIds: [] }] }).success).toBe(true);
    expect(MemoryReconciliationOutputSchema.safeParse({ changes: [{ memoryId: "memory-1", operation: "update", content: "訂正後", reason: "後続Eventで訂正", evidenceEventIds: [], evidenceMemoryIds: ["memory-1"] }] }).success).toBe(false);
    expect(MemoryReconciliationOutputSchema.safeParse({ changes: [{ memoryId: "memory-1", operation: "split", reason: "二つの事実", evidenceEventIds: ["event-1"], evidenceMemoryIds: ["memory-1"], split: [{ content: "一つ目", reason: "理由" }, { content: "二つ目", reason: "理由" }] }] }).success).toBe(true);
  });

  it("C-10, FR-10: rejects a Memory Reflector result that cites an Event outside its fixed Session", async () => {
    const failures: unknown[] = [];
    const reflection = new TargetedReflection({
      load: () => Promise.resolve(input), refresh: (value) => Promise.resolve(value),
      beginTarget: (_input, target) => Promise.resolve(target === "memory" ? "pending" : "completed"),
      memoryBatches: (value) => Promise.resolve([{ batchIndex: 0, events: value.events }]), beginMemoryBatch: () => Promise.resolve("pending"), commitMemoryBatch: () => Promise.resolve(), failMemoryBatch: () => Promise.resolve(), completeMemoryTarget: () => Promise.resolve(),
      commitTarget: () => Promise.resolve(), failTarget: (_input, _target, error) => { failures.push(error); return Promise.resolve(); },
      blockTarget: () => Promise.resolve(), complete: () => Promise.resolve(), fail: () => Promise.resolve()
    }, {
      reflect: () => Promise.resolve({ output: { memories: [{ content: "根拠外の記憶", reason: "test", evidenceEventIds: ["foreign-event"], target: "episodic", perspective: "self", subjects: [] }] }, toolExecutions: [] })
    });
    await reflection.process("reflection-1", "agent-a", new AbortController().signal);
    expect(failures).toHaveLength(1);
    expect(failures[0]).toMatchObject({ code: "VALIDATION" });
  });

  it("FR-71: processes a fixed 64 Event Session as four 16-Event Formation batches before one integration pass", async () => {
    const events = Array.from({ length: 64 }, (_, index) => ({ id: `event-${String(index + 1)}`, occurredAt: `2026-01-01T00:${String(Math.floor(index / 60)).padStart(2, "0")}:${String(index % 60).padStart(2, "0")}Z`, summary: `Event ${String(index + 1)}` }));
    const calls: { target: string; eventIds: readonly string[] }[] = [];
    const committed: number[] = [];
    const completeMemory: string[] = [];
    const reflection = new TargetedReflection({
      load: () => Promise.resolve({ ...input, events }), refresh: (value) => Promise.resolve(value),
      beginTarget: () => Promise.resolve("pending"),
      memoryBatches: (value) => Promise.resolve([0, 1, 2, 3].map((batchIndex) => ({ batchIndex, events: value.events.slice(batchIndex * 16, (batchIndex + 1) * 16) }))),
      beginMemoryBatch: () => Promise.resolve("pending"),
      commitMemoryBatch: (_input, batch) => { committed.push(batch.batchIndex); return Promise.resolve(); },
      failMemoryBatch: () => Promise.resolve(), completeMemoryTarget: (value) => { completeMemory.push(value.reflectionId); return Promise.resolve(); },
      commitTarget: () => Promise.resolve(), failTarget: () => Promise.resolve(), blockTarget: () => Promise.resolve(), complete: () => Promise.resolve(), fail: () => Promise.resolve()
    }, { reflect: (target, value) => {
      calls.push({ target, eventIds: value.events.map(({ id }) => id) });
      if (target === "memory") return Promise.resolve({ output: { memories: [{ content: `Memory ${String(value.events[0]?.id)}`, reason: "batch", evidenceEventIds: [value.events[0]?.id ?? "event-1"], target: "episodic", perspective: "self", subjects: [] }] }, toolExecutions: [] });
      if (target === "concern") return Promise.resolve({ output: { concernChanges: [], evidenceMemoryIds: [] }, toolExecutions: [] });
      if (target === "relationship") return Promise.resolve({ output: { relationshipChanges: [] }, toolExecutions: [] });
      return Promise.resolve({ output: { evidenceMemoryIds: [] }, toolExecutions: [] });
    } });
    await reflection.process("reflection-1", "agent-a", new AbortController().signal);
    expect(calls.filter(({ target }) => target === "memory").map(({ eventIds }) => eventIds.length)).toEqual([16, 16, 16, 16]);
    expect(calls.map(({ target }) => target)).toEqual(["memory", "memory", "memory", "memory", "concern", "relationship", "self-mood"]);
    expect(committed).toEqual([0, 1, 2, 3]);
    expect(completeMemory).toEqual(["reflection-1"]);
  });

  it("FR-60, NFR-17: retries only the failed Memory batch and leaves a completed batch untouched", async () => {
    const events = Array.from({ length: 64 }, (_, index) => ({ id: `retry-event-${String(index + 1)}`, occurredAt: "2026-01-01T00:00:00Z", summary: `Event ${String(index + 1)}` }));
    const retried: string[][] = [];
    const calls: string[] = [];
    const reflection = new TargetedReflection({
      load: () => Promise.resolve({ ...input, events }), refresh: (value) => Promise.resolve(value), beginTarget: () => Promise.resolve("pending"),
      memoryBatches: (value) => Promise.resolve([{ batchIndex: 0, events: value.events.slice(0, 32) }, { batchIndex: 1, events: value.events.slice(32) }]),
      beginMemoryBatch: (_input, batch) => Promise.resolve(batch.batchIndex === 0 ? "completed" : "pending"),
      commitMemoryBatch: (_input, batch) => { retried.push(batch.events.map(({ id }) => id)); return Promise.resolve(); }, failMemoryBatch: () => Promise.resolve(), completeMemoryTarget: () => Promise.resolve(),
      commitTarget: () => Promise.resolve(), failTarget: () => Promise.resolve(), blockTarget: () => Promise.resolve(), complete: () => Promise.resolve(), fail: () => Promise.resolve()
    }, { reflect: (target, value) => {
      calls.push(target);
      if (target === "memory") return Promise.resolve({ output: { memories: [{ content: "Retry memory", reason: "batch", evidenceEventIds: [value.events[0]?.id ?? "retry-event-33"], target: "episodic", perspective: "self", subjects: [] }] }, toolExecutions: [] });
      if (target === "concern") return Promise.resolve({ output: { concernChanges: [], evidenceMemoryIds: [] }, toolExecutions: [] });
      if (target === "relationship") return Promise.resolve({ output: { relationshipChanges: [] }, toolExecutions: [] });
      return Promise.resolve({ output: { evidenceMemoryIds: [] }, toolExecutions: [] });
    } });
    await reflection.process("reflection-1", "agent-a", new AbortController().signal);
    expect(calls.filter((target) => target === "memory")).toEqual(["memory"]);
    expect(retried).toEqual([["retry-event-33", ...Array.from({ length: 31 }, (_, index) => `retry-event-${String(index + 34)}`)]]);
  });

  it("FR-41, FR-60: executes target Reflectors in dependency order and blocks downstream targets after Memory fails", async () => {
    const calls: string[] = [];
    const statuses: string[] = [];
    const reflection = new TargetedReflection({
      load: () => Promise.resolve(input),
      refresh: (value) => Promise.resolve(value),
      beginTarget: (_input, target) => { statuses.push(`begin:${target}`); return Promise.resolve("pending"); },
      memoryBatches: (value) => Promise.resolve([{ batchIndex: 0, events: value.events }]), beginMemoryBatch: () => Promise.resolve("pending"), commitMemoryBatch: () => Promise.resolve(), failMemoryBatch: () => Promise.resolve(), completeMemoryTarget: () => Promise.resolve(),
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
      memoryBatches: (value) => Promise.resolve([{ batchIndex: 0, events: value.events }]), beginMemoryBatch: () => Promise.resolve("pending"), commitMemoryBatch: () => Promise.resolve(), failMemoryBatch: () => Promise.resolve(), completeMemoryTarget: () => Promise.resolve(),
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
      beginTarget: () => Promise.resolve("pending"), memoryBatches: (value) => Promise.resolve([{ batchIndex: 0, events: value.events }]), beginMemoryBatch: () => Promise.resolve("pending"), commitMemoryBatch: () => Promise.resolve(), failMemoryBatch: () => Promise.resolve(), completeMemoryTarget: () => Promise.resolve(), commitTarget: () => Promise.resolve(), failTarget: () => Promise.resolve(), blockTarget: () => Promise.resolve(), complete: () => Promise.resolve(), fail: () => Promise.resolve()
    }, {
      reflect: (target, value) => {
        if (target === "memory") return Promise.resolve({ output: { memories: [{ content: committedMemory.summary, reason: committedMemory.significance, evidenceEventIds: [value.events[0]?.id ?? "event-1"], target: "episodic", perspective: "user", subjects: committedMemory.subjects }] }, toolExecutions: [] });
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
