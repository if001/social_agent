import { Client, Events, GatewayIntentBits, Partials } from "discord.js";

import type { DiscordGateway, DiscordInboundMessage, DiscordReplyContext } from "./discord-adapter.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";

export class DiscordJsGateway implements DiscordGateway {
  readonly #client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent], partials: [Partials.Channel] });
  constructor(private readonly token: string, private readonly logger: Logger = noopLogger) {}
  async start(handler: (message: DiscordInboundMessage) => Promise<void>, signal: AbortSignal): Promise<void> {
    this.logger.log("info", "discord.gateway_login_started");
    void this.#client.on(Events.MessageCreate, (message) => { void handler({ id: message.id, authorId: message.author.id, isBot: message.author.bot, ...(message.guildId === null ? {} : { guildId: message.guildId }), channelId: message.channel.isThread() ? message.channel.parentId ?? message.channelId : message.channelId, ...(message.channel.isThread() ? { threadId: message.channelId } : {}), ...(message.reference?.messageId === undefined ? {} : { referencedMessageId: message.reference.messageId }), content: message.content, createdAt: message.createdAt }).catch((error: unknown) => { this.logger.log("error", "discord.message_handler_failed", { discordMessageId: message.id, channelId: message.channelId, ...errorLogContext(error) }); }); });
    await this.#client.login(this.token);
    this.logger.log("info", "discord.gateway_ready", { botUserId: this.#client.user?.id });
    if (signal.aborted) { await this.#client.destroy(); return; }
    await new Promise<void>((resolve) => { signal.addEventListener("abort", () => { this.logger.log("info", "discord.gateway_stopping"); void this.#client.destroy().then(() => { resolve(); }); }, { once: true }); });
  }
  async send(context: DiscordReplyContext, content: string, _idempotencyKey: string, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new Error("Discord delivery aborted");
    const channel = await this.#client.channels.fetch(context.threadId ?? context.channelId);
    if (channel === null || !channel.isTextBased() || !("send" in channel) || typeof channel.send !== "function") throw new Error("Discord reply channel is unavailable");
    const sent = await channel.send({ content, ...(context.messageId === undefined ? {} : { reply: { messageReference: context.messageId, failIfNotExists: false } }), allowedMentions: { repliedUser: false } });
    return sent.id;
  }
  async startTyping(context: DiscordReplyContext, signal: AbortSignal): Promise<() => void> {
    if (signal.aborted) throw new Error("Discord typing aborted");
    const channel = await this.#client.channels.fetch(context.threadId ?? context.channelId);
    if (channel === null || !channel.isTextBased() || !("sendTyping" in channel) || typeof channel.sendTyping !== "function") throw new Error("Discord typing channel is unavailable");
    let stopped = false;
    const tick = async (): Promise<void> => {
      if (stopped || signal.aborted) return;
      try { await channel.sendTyping(); }
      catch (error) { this.logger.log("warn", "discord.typing_refresh_failed", { channelId: context.threadId ?? context.channelId, ...errorLogContext(error) }); }
    };
    await tick();
    const timer = setInterval(() => { void tick(); }, 8_000);
    const stop = (): void => { if (stopped) return; stopped = true; clearInterval(timer); signal.removeEventListener("abort", stop); };
    signal.addEventListener("abort", stop, { once: true });
    return stop;
  }
}
