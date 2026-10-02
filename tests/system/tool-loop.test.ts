import { z } from "zod";
import { ScriptedAgentHarness } from "../../src/application/scripted-agent-harness.js";
import { ToolLoop } from "../../src/application/tool-loop.js";
import { ToolRegistry } from "../../src/application/tool-registry.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";

describe("ST-03 Tool Loop", () => {
  it("reinjects tool results in the run and lets the agent recover from failure", async () => {
    const harness = new ScriptedAgentHarness([
      { stateUpdates: [], memoryUpdates: [], intentionUpdates: [], longTermCandidates: [], action: { type: "tool", call: { id: "c1", name: "failing", input: { q: "x" } } } },
      (input) => { expect(input.observation.facts[0]).toContain("failed"); return { stateUpdates: [], memoryUpdates: [], intentionUpdates: [], longTermCandidates: [], action: { type: "respond", content: "Recovered" } }; }
    ]);
    const registry = new ToolRegistry([{ name: "failing", description: "Fails", schema: z.object({ q: z.string() }), execute: () => Promise.resolve({ ok: false, error: "failed" }) }]);
    const result = await new ToolLoop(harness, registry).run(agentCoreInputFixture(), new AbortController().signal);
    expect(result.output.action).toEqual({ type: "respond", content: "Recovered" }); expect(result.trace).toHaveLength(1);
  });

  it("stops at tool call and step limits", async () => {
    const toolOutput = { stateUpdates: [], memoryUpdates: [], intentionUpdates: [], longTermCandidates: [], action: { type: "tool" as const, call: { id: "c", name: "tool", input: {} } } };
    const harness = new ScriptedAgentHarness([toolOutput, toolOutput, toolOutput]); const registry = new ToolRegistry([{ name: "tool", description: "Tool", schema: z.object({}), execute: () => Promise.resolve({ ok: true }) }]);
    const input = agentCoreInputFixture(); input.limits.maxToolCalls = 1;
    await expect(new ToolLoop(harness, registry).run(input, new AbortController().signal)).rejects.toThrow("Tool call limit");
  });
});
