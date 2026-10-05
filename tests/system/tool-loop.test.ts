import { z } from "zod";

import { ToolRegistry } from "../../src/application/tool-registry.js";
import { DeepAgentHarness, createDeepAgentTools, createDeepAgentToolRunContext, createOllamaDeepAgentInvoker, type DeepAgentInvoker, type DeepAgentRunTool } from "../../src/infrastructure/agent/deep-agent-harness.js";
import type { AgentCoreOutput } from "../../src/domain/contracts.js";
import { agentCoreInputFixture, fixtureInstant } from "../../src/testing/contract-fixtures.js";

const finalOutput: AgentCoreOutput = {
  interpretation: { subjectiveMeaning: "The Tool result answered the question" },
  internalChanges: { transientStateUpdates: [], memoryProposals: [], intentionProposals: [], longTermCandidates: [] },
  action: { type: "respond", content: "The result is 42" }
};

const context = (signal: AbortSignal, maxToolCalls = 2, runId = "run-1", eventId = "event-1") => createDeepAgentToolRunContext({ agentId: "agent-a", runId, eventId, maxToolCalls, signal });

describe("ST-03 Deep Agent internal Tool Loop", () => {
  it("returns Tool results to reasoning and exposes the observed execution with the final Action", async () => {
    const registry = new ToolRegistry([{ name: "lookup", description: "Look up a value", schema: z.object({ query: z.string() }), execute: (_input, executionContext) => Promise.resolve({ ok: true, value: { answer: 42, idempotencyKey: executionContext.idempotencyKey } }) }]);
    const invoker: DeepAgentInvoker = { invoke: async (_input, options) => {
      const runContext = context(options.signal, options.maxToolCalls, options.runId, options.eventId);
      const [lookup] = createDeepAgentTools(registry, () => new Date(fixtureInstant));
      const result = await lookup?.invoke({ query: "answer" }, { context: runContext });
      expect(String(result)).toContain("42");
      return { structuredResponse: finalOutput, toolExecutions: runContext.collector.executions };
    } };
    const input = agentCoreInputFixture(); input.availableTools = [{ name: "lookup", description: "Look up a value", inputSchema: {} }];
    const result = await new DeepAgentHarness({ invoker, registeredToolNames: new Set(["lookup"]) }).run(input, new AbortController().signal);
    expect(result.output.action).toEqual({ type: "respond", content: "The result is 42" });
    expect(result.toolExecutions).toEqual([{ callId: "tool-1", runId: "run-1", eventId: "event-1", name: "lookup", input: { query: "answer" }, ok: true, result: { answer: 42, idempotencyKey: "run-1:tool-1" }, startedAt: fixtureInstant, finishedAt: fixtureInstant }]);
  });

  it("returns Tool failures to reasoning and records them", async () => {
    const registry = new ToolRegistry([{ name: "lookup", description: "Fails", schema: z.object({}), execute: () => Promise.reject(new Error("service unavailable")) }]);
    const runContext = context(new AbortController().signal); const [lookup] = createDeepAgentTools(registry, () => new Date(fixtureInstant));
    await expect(lookup?.invoke({}, { context: runContext })).resolves.toContain("service unavailable");
    expect(runContext.collector.executions[0]).toMatchObject({ ok: false, error: "service unavailable", runId: "run-1", eventId: "event-1" });
  });

  it("enforces the Tool call limit before another side effect", async () => {
    let sideEffects = 0;
    const registry = new ToolRegistry([{ name: "write", description: "Writes", schema: z.object({}), execute: () => { sideEffects += 1; return Promise.resolve({ ok: true }); } }]);
    const runContext = context(new AbortController().signal, 1); const [write] = createDeepAgentTools(registry, () => new Date(fixtureInstant));
    await write?.invoke({}, { context: runContext });
    await expect(write?.invoke({}, { context: runContext })).rejects.toMatchObject({ code: "VALIDATION" });
    expect(sideEffects).toBe(1);
    expect(runContext.collector.executions.at(-1)).toMatchObject({ ok: false, error: "Tool call limit exceeded" });
  });

  it("does not start a Tool after cancellation", async () => {
    let called = false;
    const controller = new AbortController(); controller.abort();
    const registry = new ToolRegistry([{ name: "write", description: "Writes", schema: z.object({}), execute: () => { called = true; return Promise.resolve({ ok: true }); } }]);
    const runContext = context(controller.signal); const [write] = createDeepAgentTools(registry, () => new Date(fixtureInstant));
    await expect(write?.invoke({}, { context: runContext })).rejects.toMatchObject({ code: "ABORTED" });
    expect(called).toBe(false);
    expect(runContext.collector.executions[0]).toMatchObject({ ok: false, error: "Tool execution aborted" });
  });

  it("keeps Tool execution context isolated across concurrent runs on one Agent", async () => {
    let creations = 0;
    const registry = new ToolRegistry([{ name: "lookup", description: "Lookup", schema: z.object({ query: z.string() }), execute: async ({ query }: { query: string }, executionContext) => {
      await Promise.resolve(); return { ok: true, value: { query, runId: executionContext.runId, eventId: executionContext.eventId } };
    } }]);
    const invoker = createOllamaDeepAgentInvoker({ baseUrl: "https://ollama.example", apiKey: "secret", model: "model", toolRegistry: registry, now: () => new Date(fixtureInstant), agentFactory: (factoryOptions) => {
      creations += 1; const [lookup] = factoryOptions.tools as readonly DeepAgentRunTool[];
      return { invoke: async (input, invokeOptions) => {
        const prompt = input.messages[0]?.content ?? ""; const query = prompt.includes("first") ? "first" : "second";
        await lookup?.invoke({ query }, { context: invokeOptions.context });
        return { structuredResponse: finalOutput, messages: input.messages };
      } };
    } });
    const base = { signal: new AbortController().signal, recursionLimit: 4, agentId: "agent-a", maxToolCalls: 2 };
    const [first, second] = await Promise.all([
      invoker.invoke({ messages: [{ role: "user", content: "first" }] }, { ...base, runId: "run-1", eventId: "event-1" }),
      invoker.invoke({ messages: [{ role: "user", content: "second" }] }, { ...base, runId: "run-2", eventId: "event-2" })
    ]);
    expect(creations).toBe(1);
    expect(first.toolExecutions?.[0]).toMatchObject({ runId: "run-1", eventId: "event-1", input: { query: "first" }, result: { runId: "run-1", eventId: "event-1" } });
    expect(second.toolExecutions?.[0]).toMatchObject({ runId: "run-2", eventId: "event-2", input: { query: "second" }, result: { runId: "run-2", eventId: "event-2" } });
  });
});
