import type { WebArchive } from "./web-archive.js";
import type { DiscordGateway, DiscordInboundMessage, DiscordReplyContext } from "../infrastructure/ui/discord-adapter.js";
import { errorLogContext, noopLogger, type Logger } from "../observability/logger.js";

export type PageFetcher = (url: string, signal: AbortSignal) => Promise<{ readonly docs: readonly { readonly url: string; readonly title: string; readonly markdown: string }[] }>;

export type DiscordPageIngestorOptions = {
  readonly gateway: DiscordGateway;
  readonly archive: WebArchive;
  readonly fetchPage: PageFetcher;
  readonly agentId: string;
  readonly botUserId: string;
  readonly ownerIds: ReadonlySet<string>;
  readonly guildIds: ReadonlySet<string>;
  readonly channelIds: ReadonlySet<string>;
  readonly logger?: Logger;
};

export function parseUrlOnlyMessage(content: string): string | undefined {
  const trimmed = content.trim();
  const candidate = trimmed.startsWith("<") && trimmed.endsWith(">") ? trimmed.slice(1, -1) : trimmed;
  if (/\s/u.test(candidate)) return undefined;
  try {
    const url = new URL(candidate);
    return url.protocol === "http:" || url.protocol === "https:" ? url.toString() : undefined;
  } catch { return undefined; }
}

export class DiscordPageIngestor {
  readonly #seen = new Set<string>();
  constructor(private readonly options: DiscordPageIngestorOptions) {}

  start(signal: AbortSignal): Promise<void> {
    (this.options.logger ?? noopLogger).log("info", "page_ingest.discord_starting", { agentId: this.options.agentId, ownerCount: this.options.ownerIds.size, guildCount: this.options.guildIds.size, channelCount: this.options.channelIds.size });
    return this.options.gateway.start((message) => this.#handle(message, signal), signal);
  }

  async #handle(message: DiscordInboundMessage, signal: AbortSignal): Promise<void> {
    const logger = this.options.logger ?? noopLogger;
    logger.log("debug", "page_ingest.message_received", { agentId: this.options.agentId, discordMessageId: message.id, authorId: message.authorId, channelId: message.channelId, guildId: message.guildId, isBot: message.isBot, contentCharacters: message.content.length });
    const rejectionReason = message.isBot ? "bot-author"
      : !this.options.ownerIds.has(message.authorId) ? "owner-not-allowed"
      : !this.options.channelIds.has(message.channelId) ? "channel-not-allowed"
      : message.guildId !== undefined && this.options.guildIds.size > 0 && !this.options.guildIds.has(message.guildId) ? "guild-not-allowed"
      : this.#seen.has(message.id) ? "duplicate-message"
      : undefined;
    if (rejectionReason !== undefined) {
      logger.log("debug", "page_ingest.message_ignored", { agentId: this.options.agentId, discordMessageId: message.id, channelId: message.channelId, reason: rejectionReason });
      return;
    }
    const url = parseUrlOnlyMessage(message.content);
    if (url === undefined) {
      logger.log("debug", "page_ingest.message_ignored", { agentId: this.options.agentId, discordMessageId: message.id, channelId: message.channelId, reason: "not-url-only" });
      return;
    }
    this.#seen.add(message.id);
    const replyContext: DiscordReplyContext = { channelId: message.channelId, ...(message.threadId === undefined ? {} : { threadId: message.threadId }), messageId: message.id };
    logger.log("info", "page_ingest.accepted", { agentId: this.options.agentId, discordMessageId: message.id, channelId: message.channelId, url });
    try {
      logger.log("debug", "page_ingest.fetch_started", { agentId: this.options.agentId, discordMessageId: message.id, url });
      const page = await this.options.fetchPage(url, signal);
      logger.log("debug", "page_ingest.fetch_completed", { agentId: this.options.agentId, discordMessageId: message.id, documentCount: page.docs.length });
      if (page.docs.length === 0) throw new Error("Web page service returned no documents");
      logger.log("debug", "page_ingest.archive_started", { agentId: this.options.agentId, discordMessageId: message.id, documentCount: page.docs.length });
      const archived = await this.options.archive.archivePages(page.docs, { agentId: this.options.agentId, runId: `discord-page:${message.id}`, eventId: `discord-page:${message.id}`, toolCallId: `discord-page:${message.id}` }, signal);
      logger.log("debug", "page_ingest.archive_completed", { agentId: this.options.agentId, discordMessageId: message.id, documentCount: archived.length, readyCount: archived.filter(({ status }) => status === "ready").length });
      const summaries = archived.filter(({ status, summary }) => status === "ready" && summary.trim() !== "").map(({ summary }) => summary.trim());
      if (summaries.length === 0) throw new Error("Web page could not be summarized");
      logger.log("debug", "page_ingest.reply_started", { agentId: this.options.agentId, discordMessageId: message.id, summaryCount: summaries.length });
      await this.options.gateway.send(replyContext, summaries.join("\n\n").slice(0, 2_000), `discord-page-reply:${message.id}`, signal);
      logger.log("info", "page_ingest.completed", { agentId: this.options.agentId, discordMessageId: message.id, documentCount: archived.length });
    } catch (error) {
      logger.log("error", "page_ingest.failed", { agentId: this.options.agentId, discordMessageId: message.id, ...errorLogContext(error) });
      if (!signal.aborted) {
        try { await this.options.gateway.send(replyContext, "ページを取得・保存できませんでした。", `discord-page-error:${message.id}`, signal); }
        catch (replyError) { logger.log("error", "page_ingest.error_reply_failed", { agentId: this.options.agentId, discordMessageId: message.id, ...errorLogContext(replyError) }); }
      }
    }
  }
}
