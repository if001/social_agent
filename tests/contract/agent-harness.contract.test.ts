import { ToolMessage } from "langchain";
import { z } from "zod";
import { ToolRegistry } from "../../src/application/tool-registry.js";
import { AgentCoreModelOutputJsonSchema, DeepAgentHarness, MAX_MODEL_INPUT_TOKENS, checkOllamaChatCapability, createOllamaDeepAgentInvoker, modelCallInputBudget, modelInputBudget, type DeepAgentInvoker } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { modelJsonSchema } from "../../src/infrastructure/agent/model-json-schema.js";
import { agentCoreSystemPrompt } from "../../src/infrastructure/agent/deep-agent-prompt.js";
import { compactPriorToolMessages } from "../../src/infrastructure/agent/tool-history.js";
import { summarizeModelResponse } from "../../src/infrastructure/agent/model-response.js";
import { ScriptedAgentHarness } from "../../src/application/scripted-agent-harness.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import { AgentCoreOutputSchema, type AgentCoreOutput } from "../../src/domain/contracts.js";

const output: AgentCoreOutput = { desire: "respond to this event", action: { type: "respond", content: "Hello" } };
const result = { output, toolExecutions: [] };

describe("AgentHarness contract", () => {
  it("rejects the removed legacy output shape", () => {
    expect(() => AgentCoreOutputSchema.parse({ interpretation: { activeMotive: { description: "legacy" } }, action: output.action })).toThrow();
  });
  it("removes regex constraints without removing a Tool field named pattern", () => {
    const schema = modelJsonSchema(z.object({ executeAt: z.iso.datetime({ offset: true }), pattern: z.string().min(1) }));
    expect(JSON.stringify(schema.properties)).toContain('"pattern"');
    expect(JSON.stringify((schema.properties as Record<string, unknown>).executeAt)).not.toContain('"pattern":');
  });
  it("compacts prior Tool results while preserving the latest Tool batch", () => {
    const registry = new ToolRegistry([{ name: "web_archive_read", description: "read", schema: z.object({}), resultPolicy: { kind: "content-read", defaultRequestCharacters: 2_000, runCharacterBudget: 6_000 }, execute: () => Promise.resolve({ ok: true }) }]);
    const prior = new ToolMessage({ name: "web_archive_read", tool_call_id: "old", content: JSON.stringify({ ok: true, value: { snapshotId: "s1", offset: 0, text: "x".repeat(2_000), truncated: true } }) });
    const latest = new ToolMessage({ name: "web_page", tool_call_id: "new", content: JSON.stringify({ ok: true, value: { documents: [{ snapshotId: "s2", summary: "summary" }] } }) });
    const compacted = compactPriorToolMessages([prior, { type: "ai" }, latest], registry);
    const content = (compacted[0] as ToolMessage).content; if (typeof content !== "string") throw new Error("Expected compacted string content");
    expect(content).not.toContain("x".repeat(100)); expect(content).toContain('"textCharacters":2000'); expect(compacted[2]).toBe(latest);
  });
  it("summarizes model output type and provider finish reason for tracing", () => {
    expect(summarizeModelResponse({ content: "done", tool_calls: [{ name: "submit" }], response_metadata: { done_reason: "stop" } })).toEqual({ outputType: "tool-calls", outputCharacters: 4, toolCallCount: 1, toolNames: '["submit"]', finishReason: "stop" });
    expect(summarizeModelResponse({ content: "plain", response_metadata: {} })).toMatchObject({ outputType: "text", finishReason: "not-reported" });
    expect(summarizeModelResponse({ tool_calls: [{ name: "submit" }] })).toMatchObject({ outputType: "tool-calls", outputCharacters: 0, toolCallCount: 1 });
  });
  it("returns domain output from the scripted harness", async () => {
    const harness = new ScriptedAgentHarness([output]);
    await expect(harness.run(agentCoreInputFixture(), new AbortController().signal)).resolves.toEqual(result);
  });

  it("parses structured Deep Agent output", async () => {
    let prompt = "";
    let recentToolInputs: readonly string[] | undefined;
    const invoker: DeepAgentInvoker = { invoke: (input, options) => { prompt = input.messages[0]?.content ?? ""; recentToolInputs = options.recentToolInputs; return Promise.resolve({ structuredResponse: output }); } };
    const harness = new DeepAgentHarness({ invoker, registeredToolNames: new Set() });
    const input = agentCoreInputFixture(); input.recentExperiences = [{ eventId: "history-event", runId: "history-run", agentId: input.run.agentId, occurredAt: input.run.occurredAt, eventKind: "internal", observation: { eventId: "history-event", summary: "history marker", facts: [], observedAt: input.run.occurredAt }, steps: [{ type: "tool", name: "lookup", input: { query: "same" }, result: { ok: true }, ok: true }, { type: "action", action: { type: "no-external-action", reason: "done" } }], progressChanged: false }];
    await expect(harness.run(input, new AbortController().signal)).resolves.toMatchObject(result);
    expect(prompt).not.toContain("memoryRetrievalTrace");
    expect(prompt).toContain("recentExperiences"); expect(prompt).toContain("history marker"); expect(prompt).not.toContain("recentAttempts"); expect(prompt).not.toContain("recentObservations");
    expect(recentToolInputs).toEqual(['{"tool":"lookup","input":{"query":"same"}}']);
  });

  it("does not duplicate registered Tool JSON Schemas in the Agent input prompt", async () => {
    let prompt = ""; const invoker: DeepAgentInvoker = { invoke: (input) => { prompt = input.messages[0]?.content ?? ""; return Promise.resolve({ structuredResponse: output }); } };
    const input = agentCoreInputFixture(); input.availableTools = [{ name: "lookup", description: "Search", inputSchema: { type: "object", properties: { secretSchemaMarker: { type: "string" } } } }];
    await new DeepAgentHarness({ invoker, registeredToolNames: new Set(["lookup"]) }).run(input, new AbortController().signal);
    expect(prompt).toContain('"name":"lookup"'); expect(prompt).not.toContain("secretSchemaMarker");
  });

  it("counts the system prompt, messages, Tool schemas, and output schema in the final input gate", () => {
    const input = agentCoreInputFixture();
    input.availableTools = [{ name: "lookup", description: "Search", inputSchema: { type: "object", properties: { query: { type: "string" } } } }];
    const budget = modelInputBudget(input, JSON.stringify({ input }));
    expect(budget.total).toBeLessThanOrEqual(MAX_MODEL_INPUT_TOKENS);
    expect(Object.keys(budget.components)).toEqual(["systemPrompt", "messages", "tools", "outputSchema"]);
    expect(modelInputBudget(input, "x".repeat(MAX_MODEL_INPUT_TOKENS * 4)).total).toBeGreaterThan(MAX_MODEL_INPUT_TOKENS);
  });
  it("keeps the model gate large enough for the configured 4,500-token context budget plus contracts", () => {
    expect(MAX_MODEL_INPUT_TOKENS).toBe(8_000);
    const reportedProductionInput = { systemPrompt: 418, messages: 2_722, tools: 2_009, outputSchema: 890 };
    expect(Object.values(reportedProductionInput).reduce((sum, value) => sum + value, 0)).toBeLessThanOrEqual(MAX_MODEL_INPUT_TOKENS);
  });
  it("budgets every concrete model call including accumulated Tool results", () => {
    const finalActionTool = { type: "function", function: { name: "submit_agent_action", parameters: z.toJSONSchema(AgentCoreOutputSchema) } };
    const small = modelCallInputBudget([{ role: "user", content: "hello" }], [finalActionTool]);
    const continuation = modelCallInputBudget([{ role: "user", content: "hello" }, { role: "tool", content: "あ".repeat(MAX_MODEL_INPUT_TOKENS * 5) }], []);
    expect(small.total).toBeLessThan(MAX_MODEL_INPUT_TOKENS);
    expect(Object.keys(small.components)).toEqual(["messages", "tools"]);
    expect(small.components.tools).toBeGreaterThan(0);
    expect(continuation.total).toBeGreaterThan(MAX_MODEL_INPUT_TOKENS);
  });
  it("rejects an invoker that exceeds the remaining model call budget", async () => {
    const input = agentCoreInputFixture(); input.limits.maxSteps = 1;
    const invoker: DeepAgentInvoker = { invoke: () => Promise.resolve({ structuredResponse: output, modelCalls: 2 }) };
    await expect(new DeepAgentHarness({ invoker, registeredToolNames: new Set() }).run(input, new AbortController().signal)).rejects.toMatchObject({ code: "EXTERNAL", cause: { modelCalls: 2 } });
  });
  it("passes a finalized current Event assessment into the Action decision and counts both calls", async () => {
    let decisionInput = "";
    const invoker: DeepAgentInvoker = {
      assess: () => Promise.resolve({ assessment: { meaning: "批判を改善の手掛かりと受け止めた", feeling: "悔しいが前向き" }, modelCalls: 1 }),
      invoke: (input) => { decisionInput = input.messages[0]?.content ?? ""; return Promise.resolve({ structuredResponse: output, modelCalls: 1 }); }
    };
    const result = await new DeepAgentHarness({ invoker, registeredToolNames: new Set() }).run(agentCoreInputFixture(), new AbortController().signal);
    expect(decisionInput).toContain("currentEventAssessment");
    expect(decisionInput).toContain("悔しいが前向き");
    expect(result.budget?.consumed.modelCalls).toBe(2);
  });

  it("creates one Deep Agent and keeps consecutive run inputs and contexts isolated", async () => {
    let creations = 0; const calls: { messages: unknown; context: { runId: string; eventId: string } }[] = [];
    const assessmentModel = { bindTools: () => ({ invoke: () => Promise.resolve({ tool_calls: [{ id: "assessment", name: "submit_event_assessment", args: { meaning: "応答を求められた", feeling: "応えたい" } }] }) }) };
    const invoker = createOllamaDeepAgentInvoker({ baseUrl: "https://ollama.example", apiKey: "secret", model: "model", agentFactory: (options) => {
      creations += 1;
      expect(options.tools).toHaveLength(0);
      expect(options.responseFormat).toBeDefined();
      return { invoke: (input, invokeOptions) => { calls.push({ messages: input.messages, context: invokeOptions.context }); return Promise.resolve({ structuredResponse: output, messages: input.messages }); } };
    }, modelFactory: () => assessmentModel as unknown as ReturnType<NonNullable<Parameters<typeof createOllamaDeepAgentInvoker>[0]["modelFactory"]>> });
    const first = agentCoreInputFixture(); first.run.runId = "run-1"; first.run.eventId = "event-1"; first.observation.content = "first-only";
    const second = agentCoreInputFixture(); second.run.runId = "run-2"; second.run.eventId = "event-2"; second.observation.content = "second-only";
    const harness = new DeepAgentHarness({ invoker, registeredToolNames: new Set() });
    await harness.run(first, new AbortController().signal); await harness.run(second, new AbortController().signal);
    expect(creations).toBe(1); expect(calls.map(({ context }) => ({ runId: context.runId, eventId: context.eventId }))).toEqual([{ runId: "run-1", eventId: "event-1" }, { runId: "run-2", eventId: "event-2" }]);
    expect(JSON.stringify(calls[1]?.messages)).toContain("second-only"); expect(JSON.stringify(calls[1]?.messages)).not.toContain("first-only");
  });

  it("passes presentation persona separately from experiential Self", async () => {
    let prompt = ""; const invoker: DeepAgentInvoker = { invoke: (input) => { prompt = input.messages[0]?.content ?? ""; return Promise.resolve({ structuredResponse: output }); } };
    const input = agentCoreInputFixture(); input.persona = { version: 1, identity: { displayName: "アオ" }, communication: { language: "ja", firstPerson: "僕", tone: ["明るい"], responseStyle: [], avoid: [] } };
    await new DeepAgentHarness({ invoker, registeredToolNames: new Set() }).run(input, new AbortController().signal);
    expect(prompt).toContain('"firstPerson":"僕"'); expect(agentCoreSystemPrompt).toContain("発話表現だけへ適用"); expect(agentCoreSystemPrompt).toContain("personaだけをFeelingやDesireの根拠にしません");
  });

  it("repairs invalid output once and then stops", async () => {
    let calls = 0; const toolCallLimits: number[] = []; const prompts: string[] = [];
    const invoker: DeepAgentInvoker = { invoke: ({ messages }, options) => {
      toolCallLimits.push(options.maxToolCalls); prompts.push(messages[0]?.content ?? "");
      return Promise.resolve({ structuredResponse: calls++ === 0 ? { invalid: true } : output });
    } };
    const harness = new DeepAgentHarness({ invoker, registeredToolNames: new Set(), maxRepairs: 1 });
    await expect(harness.run(agentCoreInputFixture(), new AbortController().signal)).resolves.toMatchObject(result); expect(calls).toBe(2);
    expect(toolCallLimits[0]).toBeGreaterThan(0); expect(toolCallLimits[1]).toBe(0);
    expect(prompts[1]).toContain("構造化出力専用Toolを1件だけ"); expect(prompts[1]).toContain("actionType");
    const broken = new DeepAgentHarness({ invoker: { invoke: () => Promise.resolve({ structuredResponse: {} }) }, registeredToolNames: new Set(), maxRepairs: 1 });
    await expect(broken.run(agentCoreInputFixture(), new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("registers operational Tools and the structured response format with one Deep Agent", async () => {
    const registry = new ToolRegistry([{ name: "lookup", description: "Lookup", schema: z.object({ query: z.string().min(1) }), resultPolicy: { kind: "standard" }, execute: () => Promise.resolve({ ok: true, value: {} }) }]);
    const assessmentModel = { bindTools: () => ({ invoke: () => Promise.resolve({ tool_calls: [{ id: "assessment", name: "submit_event_assessment", args: { meaning: "応答が必要", feeling: "応えたい" } }] }) }) };
    let created = 0;
    const invoker = createOllamaDeepAgentInvoker({ baseUrl: "https://ollama.example", apiKey: "secret", model: "model", toolRegistry: registry, modelFactory: () => assessmentModel as unknown as ReturnType<NonNullable<Parameters<typeof createOllamaDeepAgentInvoker>[0]["modelFactory"]>>, agentFactory: (options) => {
      created += 1; expect(options.tools).toHaveLength(1); expect(options.responseFormat).toBeDefined();
      return { invoke: (input) => Promise.resolve({ structuredResponse: { desire: output.desire, actionType: "respond", content: "Hello" }, messages: input.messages }) };
    } });
    const input = agentCoreInputFixture(); input.availableTools = [...registry.definitions()];
    await expect(new DeepAgentHarness({ invoker, registeredToolNames: new Set(["lookup"]), maxRepairs: 1 }).run(input, new AbortController().signal)).resolves.toMatchObject({ output, toolExecutions: [] });
    expect(created).toBe(1);
    expect(JSON.stringify(AgentCoreModelOutputJsonSchema)).not.toContain('"pattern"');
    const modelProperties = AgentCoreModelOutputJsonSchema.properties as Record<string, Record<string, unknown>>;
    expect(Object.keys(modelProperties)).toHaveLength(16);
    expect(Object.values(modelProperties).every(({ description }) => typeof description === "string" && description.length > 0)).toBe(true);
  });

  it("rejects unknown tools before invoking the model", async () => {
    let called = false; const invoker: DeepAgentInvoker = { invoke: () => { called = true; return Promise.resolve({ structuredResponse: output }); } };
    const input = agentCoreInputFixture(); input.availableTools.push({ name: "unknown", description: "Unknown tool", inputSchema: {} });
    await expect(new DeepAgentHarness({ invoker, registeredToolNames: new Set() }).run(input, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(called).toBe(false);
  });

  it.each([false, true])("repairs unsupported wait for schedulerGenerated=%s", async (schedulerGenerated) => {
    const input = agentCoreInputFixture();
    input.observation.content = { schedulerGenerated, targetKind: "autonomy-review" };
    let calls = 0;
    const invoker: DeepAgentInvoker = { invoke: () => Promise.resolve({ structuredResponse: calls++ === 0 ? { ...output, action: { type: "wait", reason: "対話を待つ" } } : output }) };
    await expect(new DeepAgentHarness({ invoker, registeredToolNames: new Set(), maxRepairs: 1 }).run(input, new AbortController().signal)).resolves.toMatchObject(result);
    expect(calls).toBe(2);
  });

  it("repairs an Interaction output without a concrete action", async () => {
    const input = agentCoreInputFixture();
    input.observation.content = { schedulerGenerated: true, targetKind: "autonomy-review" };
    let calls = 0;
    const invoker: DeepAgentInvoker = { invoke: () => Promise.resolve({ structuredResponse: calls++ === 0 ? { ...output, action: { type: "no-external-action", reason: "対話相手を待つ" } } : output }) };
    await expect(new DeepAgentHarness({ invoker, registeredToolNames: new Set(), maxRepairs: 1 }).run(input, new AbortController().signal)).resolves.toMatchObject(result);
    expect(calls).toBe(2);
  });

  it("rejects no-external-action after only failed Tools but accepts it after a success", async () => {
    const noAction = { ...output, action: { type: "no-external-action" as const, reason: "Toolで処理済み" } };
    let calls = 0;
    const failed: DeepAgentInvoker = { invoke: () => Promise.resolve({ structuredResponse: calls++ === 0 ? noAction : output, toolExecutions: [{ callId: "tool-1", runId: "run-1", eventId: "event-1", name: "lookup", input: {}, ok: false, error: "unavailable", startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.000Z" }] }) };
    await expect(new DeepAgentHarness({ invoker: failed, registeredToolNames: new Set(), maxRepairs: 1 }).run(agentCoreInputFixture(), new AbortController().signal)).resolves.toMatchObject({ output });
    expect(calls).toBe(2);
    const successful: DeepAgentInvoker = { invoke: () => Promise.resolve({ structuredResponse: noAction, toolExecutions: [{ callId: "tool-1", runId: "run-1", eventId: "event-1", name: "lookup", input: {}, ok: true, result: {}, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.000Z" }] }) };
    await expect(new DeepAgentHarness({ invoker: successful, registeredToolNames: new Set() }).run(agentCoreInputFixture(), new AbortController().signal)).resolves.toMatchObject({ output: noAction });
  });

  it("normalizes provider errors, abort and timeout", async () => {
    const failure: DeepAgentInvoker = { invoke: () => Promise.reject(new Error("provider secret-key failed")) };
    await expect(new DeepAgentHarness({ invoker: failure, registeredToolNames: new Set() }).run(agentCoreInputFixture(), new AbortController().signal)).rejects.toMatchObject({ code: "EXTERNAL", message: "Agent provider failed" });
    const controller = new AbortController(); controller.abort();
    await expect(new DeepAgentHarness({ invoker: failure, registeredToolNames: new Set() }).run(agentCoreInputFixture(), controller.signal)).rejects.toMatchObject({ code: "ABORTED" });
    const pending: DeepAgentInvoker = { invoke: (_input, options) => new Promise((_resolve, reject) => { options.signal.addEventListener("abort", () => { reject(new Error("aborted", { cause: options.signal.reason })); }, { once: true }); }) };
    const input = agentCoreInputFixture(); input.limits.deadlineMs = 1;
    await expect(new DeepAgentHarness({ invoker: pending, registeredToolNames: new Set() }).run(input, new AbortController().signal)).rejects.toMatchObject({ code: "TIMEOUT" });
  });

  it("checks the configured cloud model without exposing authentication", async () => {
    const requests: string[] = [];
    const fetcher: typeof fetch = (input) => { requests.push(typeof input === "string" ? input : input instanceof URL ? input.href : input.url); return Promise.resolve(new Response(JSON.stringify({ models: [{ name: "cloud-model" }] }), { status: 200 })); };
    await expect(checkOllamaChatCapability({ baseUrl: "https://ollama.example", apiKey: "secret", model: "cloud-model" }, fetcher)).resolves.toBeUndefined();
    expect(String(requests[0])).not.toContain("secret");
    await expect(checkOllamaChatCapability({ baseUrl: "https://ollama.example", apiKey: "secret", model: "missing" }, fetcher)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("describes Interaction decisions without duplicating the output schema", () => {
    expect(agentCoreSystemPrompt).toContain("目的:");
    expect(agentCoreSystemPrompt).not.toContain("構造化出力専用Tool");
    expect(agentCoreSystemPrompt).not.toContain("最小引数例");
    expect(agentCoreSystemPrompt).toContain("明示した将来時刻の処理はschedule_task");
    expect(agentCoreSystemPrompt).toContain("idle Event");
    expect(agentCoreSystemPrompt).toContain("desire");
    expect(agentCoreSystemPrompt).toContain("自律Eventではwaitを返しません");
    expect(agentCoreSystemPrompt).toContain("Tool未使用で理由だけを返すno-external-actionは禁止");
    expect(agentCoreSystemPrompt).toContain("同一手段を繰り返さず");
    expect(agentCoreSystemPrompt).not.toContain("content-readの文字予算");
    expect(agentCoreSystemPrompt).not.toContain("次のrun開始時");
    expect(agentCoreSystemPrompt).toContain("recentExperiences");
    expect(agentCoreSystemPrompt).not.toContain("recentAttempts");
  });
});
