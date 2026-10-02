import { DiscordAdapter, type DiscordGateway, type DiscordInboundMessage, type DiscordReplyContext } from "../../src/infrastructure/ui/discord-adapter.js";
import { AddressedFileQueue } from "../../src/infrastructure/queue/addressed-file-queue.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";

class FakeDiscordGateway implements DiscordGateway {
  handler?: (message: DiscordInboundMessage) => Promise<void>; readonly sent: { context: DiscordReplyContext; content: string }[] = []; failures = 0;
  start(handler: (message: DiscordInboundMessage) => Promise<void>, signal: AbortSignal): Promise<void> { this.handler = handler; return new Promise((resolve) => { signal.addEventListener("abort", () => { resolve(); }, { once: true }); }); }
  send(context: DiscordReplyContext, content: string): Promise<void> { if (this.failures-- > 0) return Promise.reject(new Error("rate limited")); this.sent.push({ context, content }); return Promise.resolve(); }
  receive(message: DiscordInboundMessage): Promise<void> { if (this.handler === undefined) throw new Error("not started"); return this.handler(message); }
}
const eventually = async (assertion: () => void): Promise<void> => { for (let attempt = 0; attempt < 200; attempt += 1) { try { assertion(); return; } catch (error) { if (attempt === 199) throw error; await new Promise((resolve) => setTimeout(resolve, 10)); } } };

describe("Discord UI adapter contract", () => {
  it("filters allowlists and publishes a stable message once", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const queue = new AddressedFileQueue(root, { now: () => new Date("2026-01-01T00:00:00Z") }); const gateway = new FakeDiscordGateway(); const adapter = new DiscordAdapter({ gateway, queue, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator([]), agentId: "agent-a", ownerIds: new Set(["owner"]), guildIds: new Set(["guild"]), channelIds: new Set(["channel"]) }); const controller = new AbortController(); const inbound = adapter.startInbound(controller.signal);
    const base = { id: "42", authorId: "owner", isBot: false, guildId: "guild", channelId: "channel", threadId: "thread", content: "hello", createdAt: new Date("2026-01-01T00:00:00Z") };
    await gateway.receive({ ...base, authorId: "other" }); await gateway.receive(base); await gateway.receive(base);
    const messages: unknown[] = []; const consumeController = new AbortController(); const consuming = queue.subscribe("agent-a", (message) => { messages.push(message); consumeController.abort(); return Promise.resolve(); }, consumeController.signal); await consuming;
    expect(messages).toMatchObject([{ id: "discord:42", replyTo: "discord", payload: { replyContext: { channelId: "channel", threadId: "thread", messageId: "42" } } }]); controller.abort(); await inbound; await scope.close();
  });
  it("retries outbound failures without ack and preserves thread reply", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const queue = new AddressedFileQueue(root, { retryDelayMs: () => 0, now: () => new Date("2026-01-01T00:00:00Z") }); const gateway = new FakeDiscordGateway(); gateway.failures = 1; const adapter = new DiscordAdapter({ gateway, queue, clock: new FixedClock(new Date()), ids: new SequenceIdGenerator([]), agentId: "agent-a", ownerIds: new Set(), guildIds: new Set(), channelIds: new Set() });
    await queue.publish({ id: "output", destination: "discord", source: "agent-a", sentAt: "2026-01-01T00:00:00Z", availableAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-02T00:00:00Z", attempt: 0, hop: 0, payload: { type: "agent-response", text: "reply", replyContext: { channelId: "channel", threadId: "thread", messageId: "42" } } });
    const controller = new AbortController(); const outbound = adapter.startOutbound(controller.signal); await eventually(() => { expect(gateway.sent).toHaveLength(1); }); expect(gateway.sent[0]).toMatchObject({ context: { threadId: "thread", messageId: "42" }, content: "reply" }); controller.abort(); await outbound; await scope.close();
  });
});
