import { DeepAgentHarness, agentCoreSystemPrompt, checkOllamaChatCapability, createOllamaDeepAgentInvoker, summarizeModelResponse, type DeepAgentInvoker } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { ScriptedAgentHarness } from "../../src/application/scripted-agent-harness.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import type { AgentCoreOutput } from "../../src/domain/contracts.js";

const output: AgentCoreOutput = { interpretation: {}, internalChanges: { immediateStateUpdates: [] }, action: { type: "respond", content: "Hello" } };
const result = { output, toolExecutions: [] };

describe("AgentHarness contract", () => {
  it("summarizes model output type and provider finish reason for tracing", () => {
    expect(summarizeModelResponse({ content: "done", tool_calls: [{ name: "submit" }], response_metadata: { done_reason: "stop" } })).toEqual({ outputType: "tool-calls", outputCharacters: 4, toolCallCount: 1, finishReason: "stop" });
    expect(summarizeModelResponse({ content: "plain", response_metadata: {} })).toMatchObject({ outputType: "text", finishReason: "not-reported" });
    expect(summarizeModelResponse({ tool_calls: [{ name: "submit" }] })).toMatchObject({ outputType: "tool-calls", outputCharacters: 0, toolCallCount: 1 });
  });
  it("returns domain output from the scripted harness", async () => {
    const harness = new ScriptedAgentHarness([output]);
    await expect(harness.run(agentCoreInputFixture(), new AbortController().signal)).resolves.toEqual(result);
  });

  it("parses structured Deep Agent output", async () => {
    let prompt = "";
    const invoker: DeepAgentInvoker = { invoke: (input) => { prompt = input.messages[0]?.content ?? ""; return Promise.resolve({ structuredResponse: output }); } };
    const harness = new DeepAgentHarness({ invoker, registeredToolNames: new Set() });
    await expect(harness.run(agentCoreInputFixture(), new AbortController().signal)).resolves.toEqual(result);
    expect(prompt).not.toContain("memoryRetrievalTrace");
  });

  it("creates one Deep Agent and keeps consecutive run inputs and contexts isolated", async () => {
    let creations = 0; const calls: { messages: unknown; context: { runId: string; eventId: string } }[] = [];
    const invoker = createOllamaDeepAgentInvoker({ baseUrl: "https://ollama.example", apiKey: "secret", model: "model", agentFactory: (options) => {
      creations += 1;
      expect(options.tools).toHaveLength(0);
      expect(options.responseFormat).toBeDefined();
      return { invoke: (input, invokeOptions) => { calls.push({ messages: input.messages, context: invokeOptions.context }); return Promise.resolve({ structuredResponse: output, messages: input.messages }); } };
    } });
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
    expect(prompt).toContain('"firstPerson":"僕"'); expect(agentCoreSystemPrompt).toContain("発話表現だけへ適用"); expect(agentCoreSystemPrompt).toContain("personaだけを根拠にEmotionやDesire");
  });

  it("repairs invalid output once and then stops", async () => {
    let calls = 0;
    const invoker: DeepAgentInvoker = { invoke: () => Promise.resolve({ structuredResponse: calls++ === 0 ? { invalid: true } : output }) };
    const harness = new DeepAgentHarness({ invoker, registeredToolNames: new Set(), maxRepairs: 1 });
    await expect(harness.run(agentCoreInputFixture(), new AbortController().signal)).resolves.toEqual(result); expect(calls).toBe(2);
    const broken = new DeepAgentHarness({ invoker: { invoke: () => Promise.resolve({ structuredResponse: {} }) }, registeredToolNames: new Set(), maxRepairs: 1 });
    await expect(broken.run(agentCoreInputFixture(), new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("rejects unknown tools before invoking the model", async () => {
    let called = false; const invoker: DeepAgentInvoker = { invoke: () => { called = true; return Promise.resolve({ structuredResponse: output }); } };
    const input = agentCoreInputFixture(); input.availableTools.push({ name: "unknown", description: "Unknown tool", inputSchema: {} });
    await expect(new DeepAgentHarness({ invoker, registeredToolNames: new Set() }).run(input, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(called).toBe(false);
  });

  it("rejects persistent state proposals in the Interaction output", async () => {
    const invalid = structuredClone(output);
    invalid.internalChanges.immediateStateUpdates.push({ target: "mood", operation: "set", value: "calm", reason: "test", evidenceIds: [] });
    let calls = 0;
    const invoker: DeepAgentInvoker = { invoke: () => Promise.resolve({ structuredResponse: calls++ === 0 ? invalid : output }) };
    await expect(new DeepAgentHarness({ invoker, registeredToolNames: new Set(), maxRepairs: 1 }).run(agentCoreInputFixture(), new AbortController().signal)).resolves.toEqual(result);
    expect(calls).toBe(2);
  });

  it("repairs immediate state proposals with invented evidence", async () => {
    const invalid = structuredClone(output);
    invalid.internalChanges.immediateStateUpdates.push({ target: "emotion", operation: "set", value: "calm", reason: "test", evidenceIds: ["foreign-event"] });
    let calls = 0; const invoker: DeepAgentInvoker = { invoke: () => Promise.resolve({ structuredResponse: calls++ === 0 ? invalid : output }) };
    await expect(new DeepAgentHarness({ invoker, registeredToolNames: new Set(), maxRepairs: 1 }).run(agentCoreInputFixture(), new AbortController().signal)).resolves.toEqual(result);
    expect(calls).toBe(2);
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

  it("describes the Interaction purpose and immediate output in Japanese", () => {
    expect(agentCoreSystemPrompt).toContain("目的:");
    expect(agentCoreSystemPrompt).toContain("immediateStateUpdates");
    expect(agentCoreSystemPrompt).toContain("EmotionとDesire");
    expect(agentCoreSystemPrompt).toContain("空配列[]");
    expect(agentCoreSystemPrompt).toContain("Expectationは独立保存せず");
  });
});
