import { ExperienceIntegration, memorySubjectsForIntegration } from "../../src/application/experience-integration.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";

const input = () => {
  const core = agentCoreInputFixture();
  core.observation = { ...core.observation, actor: { id: "user-1", type: "human" } };
  return { integrationId: "integration-1", agentId: core.run.agentId, sourceEvent: { id: core.run.eventId, agentId: core.run.agentId, kind: "user-message" as const, occurredAt: core.run.occurredAt, payload: {} }, sourceRunId: core.run.runId, input: core, result: { output: { desire: "会話を続けたい", action: { type: "respond" as const, content: "了解" } }, toolExecutions: [] } };
};

describe("ExperienceIntegration", () => {
  it("AC-017-1: uses the committed Core context and saves user memory with only the current actor as subject", async () => {
    const request = input(); const applied: unknown[] = [];
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: (_input, output) => { applied.push(output); return Promise.resolve(); }, fail: () => Promise.resolve() }, { integrate: () => Promise.resolve({ memories: [{ content: "ユーザーは来週旅行に行く予定だと話した", reason: "次回の自然な問いかけに使う", evidenceEventIds: [request.sourceEvent.id], confidence: "high", target: "episodic", perspective: "user", purpose: "user-context" }] }) });
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

  it("AC-017-2: rejects Memory evidence that was not available in the source Event", async () => {
    const request = input(); const failed: unknown[] = [];
    const integration = new ExperienceIntegration({ begin: () => Promise.resolve("created" as const), apply: () => Promise.resolve(), fail: (_input, error) => { failed.push(error); return Promise.resolve(); } }, { integrate: () => Promise.resolve({ memories: [{ content: "根拠のない記憶", reason: "test", evidenceEventIds: ["foreign-event"], confidence: "medium", target: "episodic", perspective: "self", purpose: "self-guidance" }] }) });
    await expect(integration.process(request, new AbortController().signal)).rejects.toThrow("outside its input");
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
});
