import { ToolMessage } from "langchain";
import { z } from "zod";

import { ToolRegistry } from "../../src/application/tool-registry.js";
import { DeepAgentHarness, createOllamaDeepAgentInvoker, type DeepAgentInvoker } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { createAgentCoreMiddleware } from "../../src/infrastructure/agent/deep-agent-middleware.js";
import { createDeepAgentTools, createDeepAgentToolRunContext, filterModelToolsAfterLimits, type DeepAgentRunTool } from "../../src/infrastructure/agent/deep-agent-tools.js";
import type { AgentCoreOutput } from "../../src/domain/contracts.js";
import { agentCoreInputFixture, fixtureInstant } from "../../src/testing/contract-fixtures.js";

const finalOutput: AgentCoreOutput = {
  desire: "Answer the question",
  action: { type: "respond", content: "The result is 42" }
};

const context = (signal: AbortSignal, maxToolCalls = 2, runId = "run-1", eventId = "event-1") => createDeepAgentToolRunContext({ agentId: "agent-a", runId, eventId, maxToolCalls, signal });

describe("ST-03 Deep Agent internal Tool Loop", () => {
  it("returns a hallucinated Tool name as a recoverable Tool failure", async () => {
    const logs: { level: string; step: string }[] = [];
    const logger = { child: () => logger, log: (level: string, step: string) => { logs.push({ level, step }); } };
    const middleware = createAgentCoreMiddleware(new ToolRegistry([]), logger, () => new Date(fixtureInstant)) as unknown as { wrapToolCall(request: { toolCall: { id: string; name: string; args: Record<string, unknown> }; runtime: { context: ReturnType<typeof context> } }, handler: () => Promise<unknown>): Promise<unknown> };
    const runContext = context(new AbortController().signal);
    const result = await middleware.wrapToolCall({ toolCall: { id: "provider-call", name: "scheduled_task_update", args: { taskId: "missing" } }, runtime: { context: runContext } }, () => Promise.reject(new Error("must not dispatch")));
    expect(result).toBeInstanceOf(ToolMessage);
    const content = (result as ToolMessage).content; if (typeof content !== "string") throw new Error("Expected string Tool failure content");
    expect(content).toContain('"errorCode":"UNKNOWN_TOOL"');
    expect(runContext.collector.executions).toMatchObject([{ name: "scheduled_task_update", ok: false, error: "Unknown tool: scheduled_task_update" }]);
    expect(logs).toContainEqual({ level: "warn", step: "tool.completed" });
  });

  it("removes exhausted operational Tools while preserving the structured output Tool", () => {
    const tools = [{ name: "file_read" }, { name: "web_archive_read" }, { name: "web_list" }, { name: "extract-1" }];
    const operational = new Set(["file_read", "web_archive_read", "web_list"]);
    const contentRead = new Set(["file_read", "web_archive_read"]);
    expect(filterModelToolsAfterLimits(tools, operational, contentRead, false, true).map(({ name }) => name)).toEqual(["web_list", "extract-1"]);
    expect(filterModelToolsAfterLimits(tools, operational, contentRead, true, false).map(({ name }) => name)).toEqual(["extract-1"]);
  });

  it("configures the compatibility adapter with the requested bounded Tool budget", async () => {
    let effects = 0;
    const registry = new ToolRegistry([{ name: "lookup", description: "lookup", schema: z.object({}), resultPolicy: { kind: "standard" }, execute: () => { effects += 1; return Promise.resolve({ ok: true, value: { answer: 42 } }); } }]);
    const invoker = createOllamaDeepAgentInvoker({ baseUrl: "http://unused", apiKey: "unused", model: "fake", toolRegistry: registry, agentFactory: (options) => {
      expect(options.middleware).toHaveLength(1);
      return { invoke: (_input, config) => { expect(config.context.maxToolCalls).toBe(8); return Promise.resolve({ structuredResponse: finalOutput }); } };
    } });
    await expect(invoker.invoke({ messages: [{ role: "user", content: "Look up the answer" }] }, { signal: new AbortController().signal, recursionLimit: 8, maxModelCalls: 8, agentId: "agent-a", runId: "compatibility", eventId: "event-1", maxToolCalls: 8 })).resolves.toMatchObject({ structuredResponse: finalOutput });
    expect(effects).toBe(0);
  });

  it("returns an identical recent Tool input as a Tool failure without executing it again", async () => {
    let executions = 0;
    const registry = new ToolRegistry([{ name: "lookup", description: "Lookup", schema: z.object({ query: z.string() }), resultPolicy: { kind: "standard" }, execute: () => { executions += 1; return Promise.resolve({ ok: true, value: {} }); } }]);
    const [lookup] = createDeepAgentTools(registry, () => new Date(fixtureInstant));
    const runContext = createDeepAgentToolRunContext({ agentId: "agent-a", runId: "repeat-run", eventId: "repeat-event", maxToolCalls: 2, signal: new AbortController().signal, recentToolInputs: ['{"tool":"lookup","input":{"query":"same"}}'] });
    await expect(lookup?.invoke({ query: "same" }, { context: runContext })).resolves.toContain("Recent identical Tool input");
    expect(executions).toBe(0);
    expect(runContext.collector.executions).toMatchObject([{ ok: false, error: "Recent identical Tool input must not be repeated" }]);
  });

  it("rejects an identical Tool input repeated within the same run", async () => {
    let executions = 0;
    const registry = new ToolRegistry([{ name: "lookup", description: "Lookup", schema: z.object({ query: z.string() }), resultPolicy: { kind: "standard" }, execute: () => { executions += 1; return Promise.resolve({ ok: true, value: {} }); } }]);
    const [lookup] = createDeepAgentTools(registry, () => new Date(fixtureInstant));
    const runContext = createDeepAgentToolRunContext({ agentId: "agent-a", runId: "repeat-run", eventId: "repeat-event", maxToolCalls: 25, signal: new AbortController().signal });
    await lookup?.invoke({ query: "same" }, { context: runContext });
    await expect(lookup?.invoke({ query: "same" }, { context: runContext })).resolves.toContain("must not be repeated");
    expect(executions).toBe(1);
    expect(runContext.collector.executions.at(-1)).toMatchObject({ ok: false, error: "Recent identical Tool input must not be repeated" });
  });

  it("can choose a Tool on autonomy review from Self, Concern, and Memory", async () => {
    const registry = new ToolRegistry([{ name: "lookup", description: "Search a topic", schema: z.object({ query: z.string() }), resultPolicy: { kind: "standard" }, execute: ({ query }: { query: string }) => Promise.resolve({ ok: true, value: { query, finding: "new evidence" } }) }]);
    const invoker: DeepAgentInvoker = { invoke: async (modelInput, options) => {
      const prompt = modelInput.messages[0]?.content ?? "";
      expect(prompt).toContain("autonomy-review"); expect(prompt).toContain("Understand HNSW tradeoffs"); expect(prompt).toContain("Previous index research");
      const runContext = context(options.signal, options.maxToolCalls, options.runId, options.eventId);
      const [lookup] = createDeepAgentTools(registry, () => new Date(fixtureInstant));
      await lookup?.invoke({ query: "HNSW tradeoffs" }, { context: runContext });
      return { structuredResponse: finalOutput, toolExecutions: runContext.collector.executions };
    } };
    const input = agentCoreInputFixture(); input.observation = { eventId: input.run.eventId, summary: "Autonomy review", facts: ["No user request"], observedAt: fixtureInstant, content: { targetKind: "autonomy-review", schedulerGenerated: true } }; input.state = { ...input.state, concerns: [{ id: "concern-hnsw", description: "Understand HNSW tradeoffs", whyItMatters: "Explain the main tradeoffs", status: "active" }] }; input.memories = [{ id: "memory-index", agentId: input.run.agentId, kind: "episodic", content: "Previous index research", occurredAt: fixtureInstant, createdAt: fixtureInstant, relatedSubjectIds: [], importance: "Unresolved", retrievalPriority: "normal", evidenceEventIds: [input.run.eventId] }]; input.availableTools = [{ name: "lookup", description: "Search a topic", inputSchema: {} }];
    const result = await new DeepAgentHarness({ invoker, registeredToolNames: new Set(["lookup"]) }).run(input, new AbortController().signal);
    expect(result.toolExecutions).toHaveLength(1);
  });

  it("returns Tool results to reasoning and exposes the observed execution with the final Action", async () => {
    const registry = new ToolRegistry([{ name: "lookup", description: "Look up a value", schema: z.object({ query: z.string() }), resultPolicy: { kind: "standard" }, execute: (_input, executionContext) => Promise.resolve({ ok: true, value: { answer: 42, idempotencyKey: executionContext.idempotencyKey } }) }]);
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
    const registry = new ToolRegistry([{ name: "lookup", description: "Fails", schema: z.object({}), resultPolicy: { kind: "standard" }, execute: () => Promise.reject(new Error("service unavailable")) }]);
    const runContext = context(new AbortController().signal); const [lookup] = createDeepAgentTools(registry, () => new Date(fixtureInstant));
    await expect(lookup?.invoke({}, { context: runContext })).resolves.toContain("service unavailable");
    expect(runContext.collector.executions[0]).toMatchObject({ ok: false, error: "service unavailable", runId: "run-1", eventId: "event-1" });
  });

  it("returns an actionable Tool failure at the call limit before another side effect", async () => {
    let sideEffects = 0;
    const registry = new ToolRegistry([{ name: "write", description: "Writes", schema: z.object({}), resultPolicy: { kind: "standard" }, execute: () => { sideEffects += 1; return Promise.resolve({ ok: true }); } }]);
    const runContext = context(new AbortController().signal, 1); const [write] = createDeepAgentTools(registry, () => new Date(fixtureInstant));
    await write?.invoke({}, { context: runContext });
    await expect(write?.invoke({}, { context: runContext })).resolves.toContain("TOOL_CALL_LIMIT_REACHED");
    expect(sideEffects).toBe(1);
    expect(runContext.collector.executions.at(-1)).toMatchObject({ ok: false, error: "Tool call limit reached. No more Tools can be used for this task." });
  });

  it("bounds cumulative content-read text within one Deep Agent run", async () => {
    let reads = 0;
    const contentPolicy = { kind: "content-read" as const, defaultRequestCharacters: 2_000, runCharacterBudget: 6_000 };
    const registry = new ToolRegistry([
      { name: "web_archive_read", description: "Read archive", schema: z.object({ snapshotId: z.string() }), resultPolicy: contentPolicy, execute: () => { reads += 1; return Promise.resolve({ ok: true, value: { text: "x".repeat(2_000) } }); } },
      { name: "file_read", description: "Read file", schema: z.object({ path: z.string() }), resultPolicy: contentPolicy, execute: () => { reads += 1; return Promise.resolve({ ok: true, value: { content: "x".repeat(2_000) } }); } }
    ]);
    const runContext = context(new AbortController().signal, 8); const [read, fileRead] = createDeepAgentTools(registry, () => new Date(fixtureInstant));
    if (read === undefined || fileRead === undefined) throw new Error("content readers were not registered");
    const results = await Promise.all([read.invoke({ snapshotId: "one" }, { context: runContext }), fileRead.invoke({ path: "two" }, { context: runContext }), read.invoke({ snapshotId: "three" }, { context: runContext }), fileRead.invoke({ path: "four" }, { context: runContext })]);
    expect(results.filter((result) => String(result).includes("Content read limit reached"))).toHaveLength(1);
    expect(results.at(-1)).toContain('"errorCode":"CONTENT_READ_LIMIT_REACHED"');
    expect(results.at(-1)).not.toContain("run");
    expect(results.at(-1)).not.toContain("6000");
    expect(reads).toBe(3); expect(runContext.collector.contentReadCharacters).toBe(6_000); expect(runContext.collector.contentReadReservedCharacters).toBe(6_000); expect(runContext.collector.executions.some(({ ok }) => !ok)).toBe(true);
  });

  it("does not start a Tool after cancellation", async () => {
    let called = false;
    const controller = new AbortController(); controller.abort();
    const registry = new ToolRegistry([{ name: "write", description: "Writes", schema: z.object({}), resultPolicy: { kind: "standard" }, execute: () => { called = true; return Promise.resolve({ ok: true }); } }]);
    const runContext = context(controller.signal); const [write] = createDeepAgentTools(registry, () => new Date(fixtureInstant));
    await expect(write?.invoke({}, { context: runContext })).rejects.toMatchObject({ code: "ABORTED" });
    expect(called).toBe(false);
    expect(runContext.collector.executions[0]).toMatchObject({ ok: false, error: "Tool execution aborted" });
  });

  it("keeps Tool execution context isolated across concurrent runs on one Agent", async () => {
    let creations = 0;
    const registry = new ToolRegistry([{ name: "lookup", description: "Lookup", schema: z.object({ query: z.string() }), resultPolicy: { kind: "standard" }, execute: async ({ query }: { query: string }, executionContext) => {
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
    const base = { signal: new AbortController().signal, recursionLimit: 4, maxModelCalls: 4, agentId: "agent-a", maxToolCalls: 2 };
    const [first, second] = await Promise.all([
      invoker.invoke({ messages: [{ role: "user", content: "first" }] }, { ...base, runId: "run-1", eventId: "event-1" }),
      invoker.invoke({ messages: [{ role: "user", content: "second" }] }, { ...base, runId: "run-2", eventId: "event-2" })
    ]);
    expect(creations).toBe(1);
    expect(first.toolExecutions?.[0]).toMatchObject({ runId: "run-1", eventId: "event-1", input: { query: "first" }, result: { runId: "run-1", eventId: "event-1" } });
    expect(second.toolExecutions?.[0]).toMatchObject({ runId: "run-2", eventId: "event-2", input: { query: "second" }, result: { runId: "run-2", eventId: "event-2" } });
  });
});
