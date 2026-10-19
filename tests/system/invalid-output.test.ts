import { DeepAgentHarness } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { AgentStatePatchService } from "../../src/application/agent-state-patch.js";
import { ToolRegistry } from "../../src/application/tool-registry.js";
import { agentCoreInputFixture, messageFixture } from "../../src/testing/contract-fixtures.js";
import { InMemoryRuntimePersistence } from "../../src/testing/in-memory-runtime-persistence.js";
import { AgentRuntime, OutboxDispatcher } from "../../src/application/agent-runtime.js";
import { SequenceIdGenerator } from "../../src/infrastructure/system.js";
import type { MessageEnvelope } from "../../src/domain/contracts.js";

describe("ST-07 abnormal output", () => {
  it("FR-14: repairs an invalid Agent Turn and delivers a response to the user", async () => {
    const input = agentCoreInputFixture(); let calls = 0; const prompts: string[] = [];
    const harness = new DeepAgentHarness({
      invoker: {
        invoke: ({ messages }) => {
          prompts.push(messages[0]?.content ?? ""); calls += 1;
          return Promise.resolve({ structuredResponse: calls === 1
            ? { desire: "答えたい", action: "respond", patch: { relationship: { operation: "update" } } }
            : { desire: "ユーザーへ回答する", action: { type: "respond", content: "修正後の回答です" } }, modelCalls: 1 });
        }
      },
      registeredToolNames: new Set(), maxRepairs: 1
    });
    const persistence = new InMemoryRuntimePersistence(() => input); let handler: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const queue = { publish: () => Promise.resolve(), subscribe: (_destination: string, received: (message: MessageEnvelope) => Promise<void>) => { handler = received; return Promise.resolve(); } };
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue, harness, persistence, ids: new SequenceIdGenerator(["event", "response"]), now: () => new Date(input.run.occurredAt) });
    await runtime.start(new AbortController().signal);
    await expect(handler?.(messageFixture({ destination: "agent-a", replyTo: "terminal", payload: { type: "user-message", text: "回答してください" } }))).resolves.toBeUndefined();
    expect(calls).toBe(2); expect(prompts[1]).toContain("無効な出力"); expect(prompts[1]).toContain("Invalid input: expected object, received string");
    const pending = await persistence.pendingOutbox(10); expect(pending).toHaveLength(1); expect(pending[0]?.envelope.payload).toMatchObject({ type: "agent-response", text: "修正後の回答です" });
    await expect(new OutboxDispatcher(persistence, queue).dispatch()).resolves.toBe(1);
  });

  it("FR-15, FR-32, NFR-1: leaves no state side effects for invalid output, forbidden state, unknown tools, or foreign context", async () => {
    const input = agentCoreInputFixture(); const before = structuredClone(input.state); const harness = new DeepAgentHarness({ invoker: { invoke: () => Promise.resolve({ structuredResponse: { invalid: true } }) }, registeredToolNames: new Set(), maxRepairs: 1 });
    await expect(harness.run(input, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(() => new AgentStatePatchService().apply("agent-b", input.state, undefined, input.run.eventId)).toThrow();
    await expect(new ToolRegistry([]).execute("unknown", {}, { agentId: "agent-a", runId: "run", idempotencyKey: "key" }, new AbortController().signal)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(input.state).toEqual(before);
  });

  it("FR-15, FR-37: hands observed Tool executions to failure persistence when final output is invalid", async () => {
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

  it("FR-15, AC-1: does not commit or enqueue a response when both initial output and repair are invalid", async () => {
    const input = agentCoreInputFixture(); let calls = 0;
    const harness = new DeepAgentHarness({ invoker: { invoke: () => { calls += 1; return Promise.resolve({ structuredResponse: { desire: "答えたい", action: 42 }, modelCalls: 1 }); } }, registeredToolNames: new Set(), maxRepairs: 1 });
    const persistence = new InMemoryRuntimePersistence(() => input); let handler: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const queue = { publish: () => Promise.resolve(), subscribe: (_destination: string, received: (message: MessageEnvelope) => Promise<void>) => { handler = received; return Promise.resolve(); } };
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue, harness, persistence, ids: new SequenceIdGenerator(["failed-event"]), now: () => new Date(input.run.occurredAt) });
    await runtime.start(new AbortController().signal);
    await expect(handler?.(messageFixture({ destination: "agent-a", replyTo: "terminal", payload: { type: "user-message", text: "回答してください" } }))).rejects.toMatchObject({ code: "VALIDATION" });
    expect(calls).toBe(2); expect(persistence.events).toHaveLength(0); expect(persistence.receipts.size).toBe(0); expect(await persistence.pendingOutbox(10)).toHaveLength(0); expect(persistence.failures).toHaveLength(1);
  });

  it("FR-16: delivers a non-empty fallback when every model attempt returns a string action for user input", async () => {
    const input = agentCoreInputFixture(); input.observation = { ...input.observation, kind: "user-message" }; let calls = 0;
    const harness = new DeepAgentHarness({ invoker: { invoke: () => { calls += 1; return Promise.resolve({ structuredResponse: { desire: "答えたい", action: "respond" }, modelCalls: 1 }); } }, registeredToolNames: new Set(), maxRepairs: 2 });
    const persistence = new InMemoryRuntimePersistence(() => input); let handler: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const queue = { publish: () => Promise.resolve(), subscribe: (_destination: string, received: (message: MessageEnvelope) => Promise<void>) => { handler = received; return Promise.resolve(); } };
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue, harness, persistence, ids: new SequenceIdGenerator(["fallback-event", "fallback-response"]), now: () => new Date(input.run.occurredAt) });
    await runtime.start(new AbortController().signal);
    await expect(handler?.(messageFixture({ destination: "agent-a", replyTo: "terminal", payload: { type: "user-message", text: "回答してください" } }))).resolves.toBeUndefined();
    expect(calls).toBe(3); expect(persistence.events).toHaveLength(1); expect(persistence.receipts.size).toBe(1); expect(persistence.failures).toHaveLength(0);
    const pending = await persistence.pendingOutbox(10); expect(pending).toHaveLength(1);
    expect(pending[0]?.envelope.payload).toMatchObject({ type: "agent-response", text: "申し訳ありません。応答の形式を処理できませんでした。もう一度お試しください。" });
  });
});
