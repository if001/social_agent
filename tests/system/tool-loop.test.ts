import { z } from "zod";

import { ToolRegistry } from "../../src/application/tool-registry.js";
import { DeepAgentHarness, createDeepAgentTools, type DeepAgentInvoker } from "../../src/infrastructure/agent/deep-agent-harness.js";
import type { AgentCoreOutput, ToolExecutionRecord } from "../../src/domain/contracts.js";
import { agentCoreInputFixture, fixtureInstant } from "../../src/testing/contract-fixtures.js";

const finalOutput: AgentCoreOutput = {
  interpretation: { subjectiveMeaning: "The Tool result answered the question" },
  internalChanges: { transientStateUpdates: [], memoryProposals: [], intentionProposals: [], longTermCandidates: [] },
  action: { type: "respond", content: "The result is 42" }
};

const context = (signal: AbortSignal, maxToolCalls = 2) => ({ agentId: "agent-a", runId: "run-1", eventId: "event-1", maxToolCalls, signal });

describe("ST-03 Deep Agent internal Tool Loop", () => {
  it("returns Tool results to reasoning and exposes the observed execution with the final Action", async () => {
    const registry = new ToolRegistry([{ name: "lookup", description: "Look up a value", schema: z.object({ query: z.string() }), execute: (_input, executionContext) => Promise.resolve({ ok: true, value: { answer: 42, idempotencyKey: executionContext.idempotencyKey } }) }]);
    const invoker: DeepAgentInvoker = { invoke: async (_input, options) => {
      const executions: ToolExecutionRecord[] = [];
      const [lookup] = createDeepAgentTools(registry, options, executions, () => new Date(fixtureInstant));
      const result = await lookup?.invoke({ query: "answer" });
      expect(String(result)).toContain("42");
      return { structuredResponse: finalOutput, toolExecutions: executions };
    } };
    const input = agentCoreInputFixture(); input.availableTools = [{ name: "lookup", description: "Look up a value", inputSchema: {} }];
    const result = await new DeepAgentHarness({ invoker, registeredToolNames: new Set(["lookup"]) }).run(input, new AbortController().signal);
    expect(result.output.action).toEqual({ type: "respond", content: "The result is 42" });
    expect(result.toolExecutions).toEqual([{ callId: "tool-1", runId: "run-1", eventId: "event-1", name: "lookup", input: { query: "answer" }, ok: true, result: { answer: 42, idempotencyKey: "run-1:tool-1" }, startedAt: fixtureInstant, finishedAt: fixtureInstant }]);
  });

  it("returns Tool failures to reasoning and records them", async () => {
    const registry = new ToolRegistry([{ name: "lookup", description: "Fails", schema: z.object({}), execute: () => Promise.reject(new Error("service unavailable")) }]);
    const executions: ToolExecutionRecord[] = [];
    const [lookup] = createDeepAgentTools(registry, context(new AbortController().signal), executions, () => new Date(fixtureInstant));
    await expect(lookup?.invoke({})).resolves.toContain("service unavailable");
    expect(executions[0]).toMatchObject({ ok: false, error: "service unavailable", runId: "run-1", eventId: "event-1" });
  });

  it("enforces the Tool call limit before another side effect", async () => {
    let sideEffects = 0;
    const registry = new ToolRegistry([{ name: "write", description: "Writes", schema: z.object({}), execute: () => { sideEffects += 1; return Promise.resolve({ ok: true }); } }]);
    const executions: ToolExecutionRecord[] = [];
    const [write] = createDeepAgentTools(registry, context(new AbortController().signal, 1), executions, () => new Date(fixtureInstant));
    await write?.invoke({});
    await expect(write?.invoke({})).rejects.toMatchObject({ code: "VALIDATION" });
    expect(sideEffects).toBe(1);
    expect(executions.at(-1)).toMatchObject({ ok: false, error: "Tool call limit exceeded" });
  });

  it("does not start a Tool after cancellation", async () => {
    let called = false;
    const controller = new AbortController(); controller.abort();
    const registry = new ToolRegistry([{ name: "write", description: "Writes", schema: z.object({}), execute: () => { called = true; return Promise.resolve({ ok: true }); } }]);
    const executions: ToolExecutionRecord[] = [];
    const [write] = createDeepAgentTools(registry, context(controller.signal), executions, () => new Date(fixtureInstant));
    await expect(write?.invoke({})).rejects.toMatchObject({ code: "ABORTED" });
    expect(called).toBe(false);
    expect(executions[0]).toMatchObject({ ok: false, error: "Tool execution aborted" });
  });
});
