import { AgentRuntime } from "../../src/application/agent-runtime.js";
import { AgentCoreInputSchema } from "../../src/domain/contracts.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import { InMemoryRuntimePersistence } from "../../src/testing/in-memory-runtime-persistence.js";
import { SequenceIdGenerator } from "../../src/infrastructure/system.js";

describe("Experience Integration Runtime boundary", () => {
  it("AC-017-3: commits the response even when post-commit Integration cannot be enqueued", async () => {
    const persistence = new InMemoryRuntimePersistence((event) => { const input = agentCoreInputFixture(); input.run = { ...input.run, eventId: event.id, agentId: event.agentId }; input.state = { ...input.state, agentId: event.agentId }; return input; });
    const runtime = new AgentRuntime({ destination: "a", defaultOutputDestination: "terminal", queue: { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() }, harness: { run: () => Promise.resolve({ output: { desire: "返したい", action: { type: "respond", content: "返答" } }, toolExecutions: [] }) }, persistence, ids: new SequenceIdGenerator(["response"]), now: () => new Date("2026-01-01T00:00:00Z"), experienceIntegration: { enqueue: () => Promise.reject(new Error("queue unavailable")) } });
    await expect(runtime.process({ id: "event-1", agentId: "a", kind: "internal", occurredAt: "2026-01-01T00:00:00Z", payload: { targetKind: "idle", destination: "terminal" } }, new AbortController().signal)).resolves.toEqual({ type: "respond", content: "返答" });
    expect(persistence.events).toHaveLength(1);
    expect(await persistence.pendingOutbox(10)).toHaveLength(1);
  });

  it("C-23: does not persist runtime-only persistentState in Experience Integration input", async () => {
    const persistence = new InMemoryRuntimePersistence((event) => {
      const input = agentCoreInputFixture();
      input.run = { ...input.run, eventId: event.id, agentId: event.agentId };
      input.state = { ...input.state, agentId: event.agentId, concerns: [] };
      const persistentState = { ...input.state, concerns: [{ id: "concern-1", description: "保持する関心", whyItMatters: "実行時だけの完全State", status: "active" as const, createdAt: "2026-01-01T00:00:00.000Z", reconsiderAt: "2026-01-02T00:00:00.000Z" }] };
      return { ...input, persistentState };
    });
    const requests: unknown[] = [];
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue: { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() }, harness: { run: () => Promise.resolve({ output: { desire: "返したい", action: { type: "respond", content: "返答" } }, toolExecutions: [] }) }, persistence, ids: new SequenceIdGenerator(["response"]), now: () => new Date("2026-01-01T00:00:00Z"), experienceIntegration: { enqueue: (request) => { requests.push(request.input); return Promise.resolve(); } } });

    await runtime.process({ id: "event-1", agentId: "agent-a", kind: "internal", occurredAt: "2026-01-01T00:00:00Z", payload: { targetKind: "idle", destination: "terminal" } }, new AbortController().signal);

    expect(requests).toHaveLength(1);
    expect(AgentCoreInputSchema.parse(requests[0])).toMatchObject({ state: { concerns: [] } });
  });
});
