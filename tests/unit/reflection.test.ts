import { Reflection, ReflectionOutputSchema, type ReflectionInput, type ReflectionOutput } from "../../src/application/reflection.js";

const input: ReflectionInput = {
  reflectionId: "reflection-1", agentId: "agent-a", expectedVersion: 2,
  self: { identity: "Agent A", disposition: "丁寧に確かめる", selfStory: "対話から学んでいる", commitments: ["約束を守る"] },
  state: { concerns: [], relationships: [] },
  events: [{ id: "event-1", occurredAt: "2026-01-01T00:00:00Z", summary: "約束を果たした" }],
  memories: [{ id: "memory-1", summary: "約束を果たした", significance: "信頼が深まった", subjects: ["user"], occurredAt: "2026-01-01T00:00:00Z", createdAt: "2026-01-01T00:01:00Z" }]
};

describe("Reflection", () => {
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

  it("FR-25, FR-41: rejects creation of a new Concern during Reflection", async () => {
    const reflection = new Reflection({ load: () => Promise.resolve(input), commit: () => Promise.resolve("committed"), fail: () => Promise.resolve() }, { reflect: () => Promise.resolve({ memories: [], concernChanges: [{ operation: "upsert", concern: { id: "new-concern", description: "新しい対象を調べる", whyItMatters: "知りたいため", status: "active" } }], relationshipChanges: [], evidenceMemoryIds: [] }) });
    await expect(reflection.process("reflection-1", "agent-a", new AbortController().signal)).rejects.toThrow("cannot create a new Concern");
  });
});
