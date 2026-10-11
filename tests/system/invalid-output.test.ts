import { DeepAgentHarness } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { AgentStatePatchService } from "../../src/application/agent-state-patch.js";
import { ToolRegistry } from "../../src/application/tool-registry.js";
import { agentCoreInputFixture, messageFixture } from "../../src/testing/contract-fixtures.js";
import { InMemoryRuntimePersistence } from "../../src/testing/in-memory-runtime-persistence.js";
import { AgentRuntime } from "../../src/application/agent-runtime.js";
import { SequenceIdGenerator } from "../../src/infrastructure/system.js";
import type { MessageEnvelope } from "../../src/domain/contracts.js";

describe("ST-07 abnormal output", () => {
  it("leaves no state side effects for invalid output, forbidden state, unknown tools, or foreign context", async () => {
    const input = agentCoreInputFixture(); const before = structuredClone(input.state); const harness = new DeepAgentHarness({ invoker: { invoke: () => Promise.resolve({ structuredResponse: { invalid: true } }) }, registeredToolNames: new Set(), maxRepairs: 1 });
    await expect(harness.run(input, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(() => new AgentStatePatchService().apply("agent-b", input.state, undefined, input.run.eventId)).toThrow();
    await expect(new ToolRegistry([]).execute("unknown", {}, { agentId: "agent-a", runId: "run", idempotencyKey: "key" }, new AbortController().signal)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(input.state).toEqual(before);
  });

  it("hands observed Tool executions to failure persistence when final output is invalid", async () => {
    const input = agentCoreInputFixture(); input.availableTools = [{ name: "lookup", description: "Lookup", inputSchema: {} }];
    const toolExecution = { callId: "tool-1", runId: input.run.runId, eventId: input.run.eventId, name: "lookup", input: {}, ok: true as const, startedAt: input.run.occurredAt, finishedAt: input.run.occurredAt };
    const harness = new DeepAgentHarness({ invoker: { invoke: () => Promise.resolve({ structuredResponse: { invalid: true }, toolExecutions: [toolExecution] }) }, registeredToolNames: new Set(["lookup"]), maxRepairs: 0 });
    const persistence = new InMemoryRuntimePersistence(() => input);
    let handler: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const queue = { publish: () => Promise.resolve(), subscribe: (_destination: string, received: (message: MessageEnvelope) => Promise<void>) => { handler = received; return Promise.resolve(); } };
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue, harness, persistence, ids: new SequenceIdGenerator(["event"]), now: () => new Date(input.run.occurredAt) });
    await runtime.start(new AbortController().signal);
    await expect(handler?.(messageFixture({ destination: "agent-a", payload: { type: "user-message", text: "hello" } }))).rejects.toMatchObject({ code: "VALIDATION" });
    expect(persistence.failures[0]?.toolExecutions).toEqual([toolExecution]);
  });
});
