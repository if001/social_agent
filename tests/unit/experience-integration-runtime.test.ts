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
      const persistentState = { ...input.state, concerns: [{ id: "concern-1", description: "保持する関心", whyItMatters: "実行時だけの完全State", status: "active" as const, createdAt: "2026-01-01T00:00:00.000Z" }] };
      return { ...input, persistentState };
    });
    const requests: unknown[] = [];
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue: { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() }, harness: { run: () => Promise.resolve({ output: { desire: "返したい", action: { type: "respond", content: "返答" } }, toolExecutions: [] }) }, persistence, ids: new SequenceIdGenerator(["response"]), now: () => new Date("2026-01-01T00:00:00Z"), experienceIntegration: { enqueue: (request) => { requests.push(request.input); return Promise.resolve(); } } });

    await runtime.process({ id: "event-1", agentId: "agent-a", kind: "internal", occurredAt: "2026-01-01T00:00:00Z", payload: { targetKind: "idle", destination: "terminal" } }, new AbortController().signal);

    expect(requests).toHaveLength(1);
    expect(AgentCoreInputSchema.parse(requests[0])).toMatchObject({ state: { concerns: [] } });
  });

  it("FR-95: binds the first successful concern_get as an ID-free Focus Concern for post-commit Integration", async () => {
    const persistence = new InMemoryRuntimePersistence((event) => {
      const input = agentCoreInputFixture();
      input.run = { ...input.run, eventId: event.id, agentId: event.agentId };
      input.state = { ...input.state, agentId: event.agentId, concerns: [] };
      return { ...input, persistentState: { ...input.state, concerns: [{ id: "concern-focus", description: "展示の記録方法を確かめたい", whyItMatters: "自分の観察を比べたい", status: "active" }] } };
    });
    const requests: unknown[] = [];
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue: { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() }, harness: { run: () => Promise.resolve({ output: { desire: "確かめたい", action: { type: "respond", content: "返答" } }, toolExecutions: [{ callId: "tool-1", runId: "run", eventId: "event-1", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.000Z", name: "concern_get", input: { concernId: "concern-focus" }, result: { description: "展示の記録方法を確かめたい" }, ok: true }, { callId: "tool-2", runId: "run", eventId: "event-1", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.000Z", name: "concern_history", input: { concernId: "other-concern" }, result: {}, ok: true }] }) }, persistence, ids: new SequenceIdGenerator(["response"]), now: () => new Date("2026-01-01T00:00:00Z"), experienceIntegration: { enqueue: (request) => { requests.push(request); return Promise.resolve(); } } });

    await runtime.process({ id: "event-1", agentId: "agent-a", kind: "internal", occurredAt: "2026-01-01T00:00:00Z", payload: { targetKind: "idle", destination: "terminal" } }, new AbortController().signal);

    expect(requests).toMatchObject([{ focusConcern: { concernId: "concern-focus", description: "展示の記録方法を確かめたい", whyItMatters: "自分の観察を比べたい" } }]);
  });

  it("FR-95: does not enqueue a Focus Concern whose parent was derived by this Run", async () => {
    const persistence = new InMemoryRuntimePersistence((event) => {
      const input = agentCoreInputFixture();
      input.run = { ...input.run, eventId: event.id, agentId: event.agentId };
      input.state = { ...input.state, agentId: event.agentId, concerns: [] };
      return { ...input, persistentState: { ...input.state, concerns: [{ id: "concern-parent", description: "親関心", whyItMatters: "重要", status: "active" }] } };
    });
    const requests: unknown[] = [];
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue: { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() }, harness: { run: () => Promise.resolve({ output: { desire: "派生したい", action: { type: "no-external-action", reason: "派生のみ" } }, toolExecutions: [{ callId: "tool-1", runId: "run", eventId: "event-1", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.000Z", name: "concern_get", input: { concernId: "concern-parent" }, result: {}, ok: true }], concernProposals: [{ operation: "derive", description: "子関心", whyItMatters: "重要", derivationReason: "別に追いたい", sourceConcernId: "concern-parent", evidenceMemoryIds: ["memory-1"] }] }) }, persistence, ids: new SequenceIdGenerator(["response", "child"]), now: () => new Date("2026-01-01T00:00:00Z"), experienceIntegration: { enqueue: (request) => { requests.push(request); return Promise.resolve(); } } });

    await runtime.process({ id: "event-1", agentId: "agent-a", kind: "internal", occurredAt: "2026-01-01T00:00:00Z", payload: { targetKind: "concern-due", destination: "terminal" } }, new AbortController().signal);

    expect(requests).toHaveLength(1);
    expect(requests[0]).not.toHaveProperty("focusConcern");
  });
});
