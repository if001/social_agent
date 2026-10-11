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
  send(_context: DiscordReplyContext, content: string): Promise<string> { this.sent.push(content); return Promise.resolve(`discord-output-${String(this.sent.length)}`); }
}
const eventually = async (assertion: () => void): Promise<void> => { for (let attempt = 0; attempt < 200; attempt += 1) { try { assertion(); return; } catch (error) { if (attempt === 199) throw error; await new Promise((resolve) => setTimeout(resolve, 10)); } } };

describe("ST-02 Discord round trip", () => {
  it("uses the same agent state for Terminal and Discord", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const clock = new FixedClock(new Date("2026-01-01T00:00:00Z")); const queue = new AddressedFileQueue(root, { now: () => clock.now() }); const gateway = new Gateway();
    const persistence = new InMemoryRuntimePersistence((event) => { const input = agentCoreInputFixture(); input.run.eventId = event.id; return input; }); const harness = new ScriptedAgentHarness([{ desire: "respond to this event", action: { type: "respond", content: "terminal reply" } }, { desire: "respond to this event", action: { type: "respond", content: "discord reply" } }]);
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue, harness, persistence, ids: new SequenceIdGenerator(["event-1", "output-1", "event-2", "output-2"]), now: () => clock.now() }); const terminal = new TerminalAdapter(queue, clock, new SequenceIdGenerator(["terminal-input"])); const discord = new DiscordAdapter({ gateway, queue, clock, ids: new SequenceIdGenerator([]), agentId: "agent-a", botUserId: "bot-a", ownerIds: new Set(["owner"]), guildIds: new Set(["guild"]), channelIds: new Set(["channel"]) });
    const controller = new AbortController(); const running = runtime.start(controller.signal); const inbound = discord.startInbound(controller.signal); const outbound = discord.startOutbound(controller.signal);
    await terminal.send("agent-a", "first"); await eventually(() => { expect(persistence.events).toHaveLength(1); }); await new OutboxDispatcher(persistence, queue).dispatch();
    await gateway.handler?.({ id: "discord-input", authorId: "owner", isBot: false, guildId: "guild", channelId: "channel", content: "<@bot-a> second", createdAt: clock.now() }); await eventually(() => { expect(persistence.events).toHaveLength(2); }); await new OutboxDispatcher(persistence, queue).dispatch(); await eventually(() => { expect(gateway.sent).toEqual(["discord reply"]); });
    expect(persistence.events.map(({ agentId }) => agentId)).toEqual(["agent-a", "agent-a"]); controller.abort(); await Promise.all([running, inbound, outbound]); await scope.close();
  });

  it("routes human and bot messages only to the mentioned bot", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const clock = new FixedClock(new Date("2026-01-01T00:00:00Z")); const queue = new AddressedFileQueue(root, { now: () => clock.now() });
    const gatewayA = new Gateway(); const gatewayB = new Gateway();
    const common = { queue, clock, ids: new SequenceIdGenerator([]), ownerIds: new Set(["owner"]), guildIds: new Set(["guild"]), channelIds: new Set(["channel"]) };
    const adapterA = new DiscordAdapter({ ...common, gateway: gatewayA, agentId: "agent-a", botUserId: "bot-a", queueDestination: "discord:a" });
    const adapterB = new DiscordAdapter({ ...common, gateway: gatewayB, agentId: "agent-b", botUserId: "bot-b", queueDestination: "discord:b" });
    const controller = new AbortController(); const inboundA = adapterA.startInbound(controller.signal); const inboundB = adapterB.startInbound(controller.signal);
    const humanMessage = { id: "human-a", authorId: "owner", isBot: false, guildId: "guild", channelId: "channel", content: "<@bot-a> hello A", createdAt: clock.now() };
    const botMessage = { id: "bot-a-to-b", authorId: "bot-a", isBot: true, guildId: "guild", channelId: "channel", content: "<@bot-b> hello B", createdAt: clock.now() };
    const noMention = { id: "silent", authorId: "owner", isBot: false, guildId: "guild", channelId: "channel", content: "hello everyone", createdAt: clock.now() };
    await Promise.all([gatewayA.handler?.(humanMessage), gatewayB.handler?.(humanMessage), gatewayA.handler?.(botMessage), gatewayB.handler?.(botMessage), gatewayA.handler?.(noMention), gatewayB.handler?.(noMention)]);
    const receivedA: string[] = []; const receivedB: string[] = []; const consumeA = new AbortController(); const consumeB = new AbortController();
    await Promise.all([
      queue.subscribe("agent-a", (message) => { receivedA.push(String(message.payload.text)); consumeA.abort(); return Promise.resolve(); }, consumeA.signal),
      queue.subscribe("agent-b", (message) => { receivedB.push(String(message.payload.text)); consumeB.abort(); return Promise.resolve(); }, consumeB.signal)
    ]);
    expect(receivedA).toEqual(["hello A"]); expect(receivedB).toEqual(["hello B"]);
    controller.abort(); await Promise.all([inboundA, inboundB]); await scope.close();
  });
});
