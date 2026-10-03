import { AgentRuntime, OutboxDispatcher } from "../../src/application/agent-runtime.js";
import { ScriptedAgentHarness } from "../../src/application/scripted-agent-harness.js";
import { DiscordAdapter, type DiscordGateway, type DiscordInboundMessage, type DiscordReplyContext } from "../../src/infrastructure/ui/discord-adapter.js";
import { TerminalAdapter } from "../../src/infrastructure/ui/terminal-adapter.js";
import { AddressedFileQueue } from "../../src/infrastructure/queue/addressed-file-queue.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { InMemoryRuntimePersistence } from "../../src/testing/in-memory-runtime-persistence.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";

class Gateway implements DiscordGateway {
  handler?: (message: DiscordInboundMessage) => Promise<void>; readonly sent: string[] = [];
  start(handler: (message: DiscordInboundMessage) => Promise<void>, signal: AbortSignal): Promise<void> { this.handler = handler; return new Promise((resolve) => { signal.addEventListener("abort", () => { resolve(); }, { once: true }); }); }
  send(_context: DiscordReplyContext, content: string): Promise<void> { this.sent.push(content); return Promise.resolve(); }
}
const eventually = async (assertion: () => void): Promise<void> => { for (let attempt = 0; attempt < 200; attempt += 1) { try { assertion(); return; } catch (error) { if (attempt === 199) throw error; await new Promise((resolve) => setTimeout(resolve, 10)); } } };

describe("ST-02 Discord round trip", () => {
  it("uses the same agent state for Terminal and Discord", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const clock = new FixedClock(new Date("2026-01-01T00:00:00Z")); const queue = new AddressedFileQueue(root, { now: () => clock.now() }); const gateway = new Gateway();
    const persistence = new InMemoryRuntimePersistence((event) => { const input = agentCoreInputFixture(); input.run.eventId = event.id; return input; }); const harness = new ScriptedAgentHarness([{ interpretation: {}, internalChanges: { transientStateUpdates: [], memoryProposals: [], intentionProposals: [], longTermCandidates: [] }, action: { type: "respond", content: "terminal reply" } }, { interpretation: {}, internalChanges: { transientStateUpdates: [], memoryProposals: [], intentionProposals: [], longTermCandidates: [] }, action: { type: "respond", content: "discord reply" } }]);
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue, harness, persistence, ids: new SequenceIdGenerator(["event-1", "output-1", "event-2", "output-2"]), now: () => clock.now() }); const terminal = new TerminalAdapter(queue, clock, new SequenceIdGenerator(["terminal-input"])); const discord = new DiscordAdapter({ gateway, queue, clock, ids: new SequenceIdGenerator([]), agentId: "agent-a", ownerIds: new Set(["owner"]), guildIds: new Set(["guild"]), channelIds: new Set(["channel"]) });
    const controller = new AbortController(); const running = runtime.start(controller.signal); const inbound = discord.startInbound(controller.signal); const outbound = discord.startOutbound(controller.signal);
    await terminal.send("agent-a", "first"); await eventually(() => { expect(persistence.events).toHaveLength(1); }); await new OutboxDispatcher(persistence, queue).dispatch();
    await gateway.handler?.({ id: "discord-input", authorId: "owner", isBot: false, guildId: "guild", channelId: "channel", content: "second", createdAt: clock.now() }); await eventually(() => { expect(persistence.events).toHaveLength(2); }); await new OutboxDispatcher(persistence, queue).dispatch(); await eventually(() => { expect(gateway.sent).toEqual(["discord reply"]); });
    expect(persistence.events.map(({ agentId }) => agentId)).toEqual(["agent-a", "agent-a"]); controller.abort(); await Promise.all([running, inbound, outbound]); await scope.close();
  });
});
