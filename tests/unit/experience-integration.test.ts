import { ExperienceIntegration, memorySubjectsForIntegration } from "../../src/application/experience-integration.js";
import { experienceIntegrationSystemPrompt } from "../../src/infrastructure/agent/experience-integration-harness.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";

const input = () => {
  const core = agentCoreInputFixture();
  core.observation = { ...core.observation, actor: { id: "user-1", type: "human" } };
  return { integrationId: "integration-1", agentId: core.run.agentId, sourceEvent: { id: core.run.eventId, agentId: core.run.agentId, kind: "user-message" as const, occurredAt: core.run.occurredAt, payload: {} }, sourceRunId: core.run.runId, input: core, result: { output: { desire: "会話を続けたい", action: { type: "respond" as const, content: "了解" } }, toolExecutions: [] } };
};

describe("ExperienceIntegration", () => {
  it("FR-82: states the ID-free Memory candidate contract and the empty-memory form", () => {
    for (const field of ["content", "reason", "target", "perspective", '{"memories":[]}']) expect(experienceIntegrationSystemPrompt).toContain(field);
    expect(experienceIntegrationSystemPrompt).not.toContain("evidenceEventIds");
    expect(experienceIntegrationSystemPrompt).toContain("変化がなければ省略します");
    expect(experienceIntegrationSystemPrompt).not.toContain("省略または空配列");
  });

  it("AC-017-1: uses the committed Core context and saves user memory with only the current actor as subject", async () => {
    const request = input(); const applied: unknown[] = [];
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: (_input, output) => { applied.push(output); return Promise.resolve(); }, fail: () => Promise.resolve() }, { integrate: () => Promise.resolve({ memories: [{ content: "ユーザーは来週旅行に行く予定だと話した", reason: "次回の自然な問いかけに使う", target: "episodic", perspective: "user" }] }) });
    await integration.process(request, new AbortController().signal);
    expect(memorySubjectsForIntegration(request, (applied[0] as { memories: [] }).memories)).toEqual([["user-1"]]);
  });

  it("AC-017-3: records an Integration failure without changing the already committed runtime result", async () => {
    const request = input(); const failed: unknown[] = [];
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: () => Promise.resolve(), fail: (_input, error) => { failed.push(error); return Promise.resolve(); } }, { integrate: () => Promise.reject(new Error("provider unavailable")) });
    await expect(integration.process(request, new AbortController().signal)).rejects.toThrow("provider unavailable");
    expect(failed).toHaveLength(1);
    expect(request.result.output.action).toEqual({ type: "respond", content: "了解" });
  });

  it("FR-82: does not accept model-supplied Event evidence", async () => {
    const request = input(); const failed: unknown[] = [];
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: () => Promise.resolve(), fail: (_input, error) => { failed.push(error); return Promise.resolve(); } }, { integrate: () => Promise.resolve({ memories: [{ content: "根拠のない記憶", reason: "test", evidenceEventIds: ["foreign-event"], target: "episodic", perspective: "self" }] }) });
    await expect(integration.process(request, new AbortController().signal)).rejects.toThrow("evidenceEventIds");
    expect(failed).toHaveLength(1);
  });

  it("AC-017-6: retries a persisted pending Integration during a later drain", async () => {
    const request = input(); let applied = 0;
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("duplicate" as const), pending: () => Promise.resolve([request]), apply: () => { applied += 1; return Promise.resolve(); }, fail: () => Promise.resolve() }, { integrate: () => Promise.resolve({ memories: [] }) });
    await integration.retryPending(new AbortController().signal);
    expect(applied).toBe(1);
  });

  it("AC-017-7: processes a reserved record only after it wins the atomic claim", async () => {
    const request = input(); let invoked = 0;
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), claim: () => Promise.resolve(false), apply: () => Promise.resolve(), fail: () => Promise.resolve() }, { integrate: () => { invoked += 1; return Promise.resolve({ memories: [] }); } });
    await integration.processReserved(request, new AbortController().signal);
    expect(invoked).toBe(0);
  });

  it("C-03: repairs one invalid MemoryIntent output with its validation issues before applying it", async () => {
    const request = input(); const applied: unknown[] = []; const repairs: unknown[] = [];
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: (_input, output) => { applied.push(output); return Promise.resolve(); }, fail: () => Promise.resolve() }, {
      integrate: () => Promise.resolve({ memories: [{ content: "ユーザーは週末に展示へ行く予定", perspective: "user", purpose: "user-context" }] } as never),
      repair: (_input, issues) => { repairs.push(issues); return Promise.resolve({ memories: [{ content: "ユーザーは週末に展示へ行く予定", reason: "週明けに結果を自然に尋ねられる", target: "episodic", perspective: "user" }] }); }
    });
    await integration.process(request, new AbortController().signal);
    expect(repairs).toHaveLength(1);
    expect(applied).toHaveLength(1);
  });

  it("C-16: records a failed Integration when its one schema repair is still invalid", async () => {
    const request = input(); const failed: unknown[] = [];
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: () => Promise.resolve(), fail: (_input, error) => { failed.push(error); return Promise.resolve(); } }, {
      integrate: () => Promise.resolve({ memories: [{ content: "不完全な記憶" }] } as never),
      repair: () => Promise.resolve({ memories: [{ content: "まだ不完全" }] } as never)
    });
    await expect(integration.process(request, new AbortController().signal)).rejects.toThrow();
    expect(failed).toHaveLength(1);
  });
});
