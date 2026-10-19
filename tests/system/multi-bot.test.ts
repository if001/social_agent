import { AgentRuntime, OutboxDispatcher } from "../../src/application/agent-runtime.js";
import { ScriptedAgentHarness } from "../../src/application/scripted-agent-harness.js";
import { ToolRegistry } from "../../src/application/tool-registry.js";
import { createAgentSendTool } from "../../src/infrastructure/tools/agent-send-tool.js";
import { AddressedFileQueue } from "../../src/infrastructure/queue/addressed-file-queue.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { InMemoryRuntimePersistence } from "../../src/testing/in-memory-runtime-persistence.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";

const eventually = async (assertion: () => void): Promise<void> => { for (let attempt = 0; attempt < 200; attempt += 1) { try { assertion(); return; } catch (error) { if (attempt === 199) throw error; await new Promise((resolve) => setTimeout(resolve, 10)); } } };

describe("ST-05 bot communication", () => {
  it("NFR-1, FR-39: delivers a stopped bot's message after restart as reported external information", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const clock = new FixedClock(new Date("2026-01-01T00:00:00Z")); const queue = new AddressedFileQueue(root, { now: () => clock.now() });
    const registry = new ToolRegistry([createAgentSendTool({ queue, clock, maxHops: 4, provenance: () => ({ parentHop: 0, expiresAt: "2026-01-02T00:00:00Z", replyTo: "terminal" }) })]);
    await registry.execute("agent_send", { destinationAgentId: "agent-b", content: "The library opens at nine" }, { agentId: "agent-a", runId: "run-a", idempotencyKey: "run-a:call-1" }, new AbortController().signal);
    await new Promise((resolve) => setTimeout(resolve, 25));
    const persistence = new InMemoryRuntimePersistence((event) => { expect(event.kind).toBe("external"); expect(event.payload).toMatchObject({ senderAgentId: "agent-a", reportedContent: "The library opens at nine" }); const input = agentCoreInputFixture(); input.run.agentId = "agent-b"; input.currentSelf.agentId = "agent-b"; input.state.agentId = "agent-b"; input.memories = []; return input; });
  const runtime = new AgentRuntime({ destination: "agent-b", defaultOutputDestination: "terminal", queue, harness: new ScriptedAgentHarness([{ desire: "respond to this event", action: { type: "respond", content: "I heard that from agent A" } }]), persistence, ids: new SequenceIdGenerator(["event-b", "output-b"]), now: () => clock.now() });
    const controller = new AbortController(); const running = runtime.start(controller.signal); await eventually(() => { expect(persistence.events).toHaveLength(1); });
    await new OutboxDispatcher(persistence, queue).dispatch(); const terminal: string[] = []; const terminalController = new AbortController(); const receiving = queue.subscribe("terminal", (message) => { terminal.push(String(message.payload.text)); terminalController.abort(); return Promise.resolve(); }, terminalController.signal); await receiving;
    expect(terminal).toEqual(["I heard that from agent A"]); controller.abort(); await running; await scope.close();
  });

  it("NFR-1: does not route a reply-less agent message to the default UI destination", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const clock = new FixedClock(new Date("2026-01-01T00:00:00Z")); const queue = new AddressedFileQueue(root, { now: () => clock.now() });
    const persistence = new InMemoryRuntimePersistence((event) => { const input = agentCoreInputFixture(); input.run.agentId = event.agentId; input.currentSelf.agentId = event.agentId; input.state.agentId = event.agentId; return input; });
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "discord:agent-a", queue, harness: new ScriptedAgentHarness([{ desire: "respond to this event", action: { type: "respond", content: "No further reply is needed" } }]), persistence, ids: new SequenceIdGenerator(["event-a"]), now: () => clock.now() });
    await queue.publish({ id: "reply-without-route", destination: "agent-a", source: "agent-b", sentAt: clock.now().toISOString(), availableAt: clock.now().toISOString(), expiresAt: "2026-01-02T00:00:00Z", attempt: 0, hop: 1, payload: { type: "agent-message", senderAgentId: "agent-b", content: "Acknowledged", provenance: { runId: "run-b" } } });
    const controller = new AbortController(); const running = runtime.start(controller.signal); await eventually(() => { expect(persistence.events).toHaveLength(1); });
    await expect(persistence.pendingOutbox(10)).resolves.toHaveLength(0);
    controller.abort(); await running; await scope.close();
  });
});
