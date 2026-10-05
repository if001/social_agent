import { PostProcessService } from "../../src/application/post-process.js";
import { InMemoryRuntimePersistence } from "../../src/testing/in-memory-runtime-persistence.js";
import { agentCoreInputFixture, messageFixture } from "../../src/testing/contract-fixtures.js";
import { noopLogger } from "../../src/observability/logger.js";

describe("Post-process", () => {
  it("retries only the persistent update job after the Interaction was committed", async () => {
    const input = agentCoreInputFixture();
    const persistence = new InMemoryRuntimePersistence(() => input);
    const result = { output: { interpretation: {}, internalChanges: { immediateStateUpdates: [] }, action: { type: "respond" as const, content: "先に返答" } }, toolExecutions: [] };
    const event = { id: input.run.eventId, agentId: input.run.agentId, kind: "user-message" as const, occurredAt: input.run.occurredAt, payload: {} };
    const outgoing = messageFixture({ id: "reply", destination: "terminal" });
    await persistence.commit(messageFixture({ id: "incoming", destination: input.run.agentId }), event, input, result, { state: input.dynamicState, changes: [] }, [outgoing]);

    let calls = 0;
    const service = new PostProcessService(persistence, { run: () => {
      calls += 1;
      if (calls === 1) return Promise.reject(new Error("temporary"));
      return Promise.resolve({ persistentStateUpdates: [{ target: "mood" as const, operation: "set" as const, value: "calm", reason: "conversation", evidenceIds: [event.id] }], memoryProposals: [], intentionProposals: [], longTermCandidates: [] });
    } }, noopLogger, 1);
    await service.processAgent(input.run.agentId, new AbortController().signal);

    expect(calls).toBe(2);
    expect(persistence.postProcessFailures).toHaveLength(1);
    expect(persistence.postProcessOutputs).toHaveLength(1);
    expect(await persistence.pendingOutbox(10)).toHaveLength(1);
  });
});
