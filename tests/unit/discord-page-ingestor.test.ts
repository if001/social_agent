import { DiscordPageIngestor, parseUrlOnlyMessage } from "../../src/application/discord-page-ingestor.js";
import type { WebArchive } from "../../src/application/web-archive.js";
import type { DiscordGateway, DiscordInboundMessage, DiscordReplyContext } from "../../src/infrastructure/ui/discord-adapter.js";

class FakeGateway implements DiscordGateway {
  handler?: (message: DiscordInboundMessage) => Promise<void>;
  readonly sent: { context: DiscordReplyContext; content: string; key: string }[] = [];
  start(handler: (message: DiscordInboundMessage) => Promise<void>, signal: AbortSignal): Promise<void> {
    this.handler = handler;
    return new Promise((resolve) => { signal.addEventListener("abort", () => { resolve(); }, { once: true }); });
  }
  send(context: DiscordReplyContext, content: string, key: string): Promise<string> {
    this.sent.push({ context, content, key }); return Promise.resolve(`sent-${String(this.sent.length)}`);
  }
  receive(message: DiscordInboundMessage): Promise<void> {
    if (this.handler === undefined) throw new Error("not started");
    return this.handler(message);
  }
}

function archive(summary = "短い要約です。"): WebArchive {
  return {
    archivePages: (documents) => Promise.resolve(documents.map((document) => ({ snapshotId: "snapshot-1", url: document.url, title: document.title, summary, fetchedAt: "2026-01-01T00:00:00.000Z", status: "ready", reference: { type: "web-snapshot" as const, id: "snapshot-1" } }))),
    search: () => Promise.resolve([]),
    read: () => Promise.resolve({ snapshotId: "snapshot-1", offset: 0, text: "", truncated: false }),
    grep: () => Promise.resolve({ snapshotId: "snapshot-1", matches: [], truncated: false })
  };
}

const baseMessage: DiscordInboundMessage = { id: "message-1", authorId: "owner", isBot: false, guildId: "guild", channelId: "channel", content: "https://example.com/article", createdAt: new Date("2026-01-01T00:00:00Z") };

describe("Discord page ingestor", () => {
  it("accepts exactly one HTTP(S) URL including Discord link wrappers", () => {
    expect(parseUrlOnlyMessage("https://example.com/a?q=1")).toBe("https://example.com/a?q=1");
    expect(parseUrlOnlyMessage(" <https://example.com/a> ")).toBe("https://example.com/a");
    expect(parseUrlOnlyMessage("see https://example.com")).toBeUndefined();
    expect(parseUrlOnlyMessage("file:///tmp/page")).toBeUndefined();
  });

  it("fetches, archives and replies with only the summary once", async () => {
    const gateway = new FakeGateway(); const fetched: string[] = []; const controller = new AbortController();
    const ingestor = new DiscordPageIngestor({ gateway, archive: archive(), fetchPage: (url) => { fetched.push(url); return Promise.resolve({ docs: [{ url, title: "Example", markdown: "# body" }] }); }, agentId: "ao", botUserId: "bot", ownerIds: new Set(["owner"]), guildIds: new Set(["guild"]), channelIds: new Set(["channel"]) });
    const running = ingestor.start(controller.signal);
    await gateway.receive(baseMessage); await gateway.receive(baseMessage);
    expect(fetched).toEqual(["https://example.com/article"]);
    expect(gateway.sent).toEqual([{ context: { channelId: "channel", messageId: "message-1" }, content: "短い要約です。", key: "discord-page-reply:message-1" }]);
    controller.abort(); await running;
  });

  it("ignores other input and returns a short failure message", async () => {
    const gateway = new FakeGateway(); const controller = new AbortController();
    const ingestor = new DiscordPageIngestor({ gateway, archive: archive(), fetchPage: () => Promise.reject(new Error("offline")), agentId: "ao", botUserId: "bot", ownerIds: new Set(["owner"]), guildIds: new Set(["guild"]), channelIds: new Set(["channel"]) });
    const running = ingestor.start(controller.signal);
    await gateway.receive({ ...baseMessage, id: "text", content: "not a url" });
    await gateway.receive({ ...baseMessage, id: "other", authorId: "other" });
    await gateway.receive({ ...baseMessage, id: "wrong-channel", channelId: "other" });
    await gateway.receive({ ...baseMessage, id: "failure" });
    expect(gateway.sent).toEqual([{ context: { channelId: "channel", messageId: "failure" }, content: "ページを取得・保存できませんでした。", key: "discord-page-error:failure" }]);
    controller.abort(); await running;
  });
});
