import { DeepAgentHarness } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { StateUpdateService } from "../../src/application/state-update-service.js";
import { ToolRegistry } from "../../src/application/tool-registry.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";

describe("ST-07 abnormal output", () => {
  it("leaves no state side effects for invalid output, forbidden state, unknown tools, or foreign context", async () => {
    const input = agentCoreInputFixture(); const before = structuredClone(input.dynamicState); const harness = new DeepAgentHarness({ invoker: { invoke: () => Promise.resolve({ structuredResponse: { invalid: true } }) }, registeredToolNames: new Set(), maxRepairs: 1 });
    await expect(harness.run(input, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(() => new StateUpdateService().apply("agent-a", input.dynamicState, [{ target: "identity", operation: "set", value: "changed", reason: "invalid", evidenceIds: [] }])).toThrow();
    await expect(new ToolRegistry([]).execute("unknown", {}, { agentId: "agent-a", runId: "run", idempotencyKey: "key" }, new AbortController().signal)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(input.dynamicState).toEqual(before);
  });
});
