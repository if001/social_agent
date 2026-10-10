import { PostProcessService } from "../../src/application/post-process.js";
import { InMemoryRuntimePersistence } from "../../src/testing/in-memory-runtime-persistence.js";
import { agentCoreInputFixture, messageFixture } from "../../src/testing/contract-fixtures.js";
import { noopLogger } from "../../src/observability/logger.js";
import { candidateDetectorSystemPrompt, continuitySystemPrompt, memoryExtractionSystemPrompt } from "../../src/infrastructure/agent/post-process-harness.js";

describe("Post-process", () => {
  it("uses Japanese purpose-specific prompts with complete empty examples", () => {
    for (const prompt of [continuitySystemPrompt, memoryExtractionSystemPrompt, candidateDetectorSystemPrompt]) {
      expect(prompt).toContain("目的:");
      expect(prompt).toContain("入力:");
      expect(prompt).toContain("出力:");
      expect(prompt).toContain("空出力例:");
    }
    expect(continuitySystemPrompt).toContain("shared・initial・acquired Disposition");
    expect(continuitySystemPrompt).toContain("Persona、今回限りのEmotion");
    expect(continuitySystemPrompt).toContain("当面の満足点");
    expect(continuitySystemPrompt).toContain("具体的行動だけをIntention");
    expect(continuitySystemPrompt).toContain("件数を満たす目的では作りません");
    for (const operation of ["create", "maintain", "update", "merge", "end"]) expect(continuitySystemPrompt).toContain(operation);
  });

  it("retries only the persistent update job after the Interaction was committed", async () => {
    const input = agentCoreInputFixture();
    const persistence = new InMemoryRuntimePersistence(() => input);
    const result = { output: { interpretation: {}, internalChanges: { immediateStateUpdates: [] }, action: { type: "respond" as const, content: "先に返答" } }, toolExecutions: [] };
    const event = { id: input.run.eventId, agentId: input.run.agentId, kind: "user-message" as const, occurredAt: input.run.occurredAt, payload: {} };
    const outgoing = messageFixture({ id: "reply", destination: "terminal" });
    await persistence.commit(messageFixture({ id: "incoming", destination: input.run.agentId }), event, input, result, { state: input.dynamicState, changes: [] }, [outgoing]);

    let calls = 0;
    const service = new PostProcessService(persistence, { continuity: { run: () => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("temporary"));
      return Promise.resolve({ persistentStateUpdates: [{ target: "mood" as const, operation: "set" as const, value: "calm", reason: "conversation", evidenceIds: [event.id] }], driveProposals: [], currentInterestProposals: [], intentionProposals: [] });
    } }, memory: { run: () => Promise.resolve({ memoryProposals: [] }) }, candidate: { run: () => Promise.resolve({ longTermCandidates: [] }) } }, noopLogger, 1);
    await service.processAgent(input.run.agentId, new AbortController().signal);

    expect(calls).toBe(2);
    expect(persistence.postProcessFailures).toHaveLength(1);
    expect(persistence.postProcessOutputs).toHaveLength(2);
    expect(await persistence.pendingOutbox(10)).toHaveLength(1);
    const snapshot = persistence.postProcessOutputs[0];
    expect(snapshot).toBeDefined();
  });
});
