import { DeepAgentHarness, agentCoreSystemPrompt, checkOllamaChatCapability, type DeepAgentInvoker } from "../../src/infrastructure/agent/deep-agent-harness.js";
import { ScriptedAgentHarness } from "../../src/application/scripted-agent-harness.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import type { AgentCoreOutput } from "../../src/domain/contracts.js";

const output: AgentCoreOutput = { interpretation: {}, internalChanges: { transientStateUpdates: [], memoryProposals: [], intentionProposals: [], longTermCandidates: [] }, action: { type: "respond", content: "Hello" } };
const result = { output, toolExecutions: [] };

describe("AgentHarness contract", () => {
  it("returns domain output from the scripted harness", async () => {
    const harness = new ScriptedAgentHarness([output]);
    await expect(harness.run(agentCoreInputFixture(), new AbortController().signal)).resolves.toEqual(result);
  });

  it("parses structured Deep Agent output", async () => {
    const invoker: DeepAgentInvoker = { invoke: () => Promise.resolve({ structuredResponse: output }) };
    const harness = new DeepAgentHarness({ invoker, registeredToolNames: new Set() });
    await expect(harness.run(agentCoreInputFixture(), new AbortController().signal)).resolves.toEqual(result);
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

  it("repairs proposals that reference context records which do not exist", async () => {
    const invalid = structuredClone(output);
    invalid.internalChanges.intentionProposals.push({ operation: "update", intentionId: "missing", status: "completed", reason: "Done" });
    let calls = 0;
    const invoker: DeepAgentInvoker = { invoke: () => Promise.resolve({ structuredResponse: calls++ === 0 ? invalid : output }) };
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

  it("describes the purpose, inputs and complete proposal output in Japanese", () => {
    expect(agentCoreSystemPrompt).toContain("目的:");
    expect(agentCoreSystemPrompt).toContain("memoryProposals");
    expect(agentCoreSystemPrompt).toContain("保存用ID");
    expect(agentCoreSystemPrompt).toContain("空配列[]");
  });
});
