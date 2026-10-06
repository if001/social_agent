import { Client, Events, GatewayIntentBits, Partials } from "discord.js";

import type { DiscordGateway, DiscordInboundMessage, DiscordReplyContext } from "./discord-adapter.js";

export class DiscordJsGateway implements DiscordGateway {
  readonly #client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMessages, GatewayIntentBits.DirectMessages, GatewayIntentBits.MessageContent], partials: [Partials.Channel] });
  constructor(private readonly token: string) {}
  async start(handler: (message: DiscordInboundMessage) => Promise<void>, signal: AbortSignal): Promise<void> {
    void this.#client.on(Events.MessageCreate, (message) => { void handler({ id: message.id, authorId: message.author.id, isBot: message.author.bot, ...(message.guildId === null ? {} : { guildId: message.guildId }), channelId: message.channel.isThread() ? message.channel.parentId ?? message.channelId : message.channelId, ...(message.channel.isThread() ? { threadId: message.channelId } : {}), ...(message.reference?.messageId === undefined ? {} : { referencedMessageId: message.reference.messageId }), content: message.content, createdAt: message.createdAt }).catch(() => { /* keep gateway alive; queue delivery owns retries */ }); });
    await this.#client.login(this.token);
    if (signal.aborted) { await this.#client.destroy(); return; }
    await new Promise<void>((resolve) => { signal.addEventListener("abort", () => { void this.#client.destroy().then(() => { resolve(); }); }, { once: true }); });
  }
  async send(context: DiscordReplyContext, content: string, _idempotencyKey: string, signal: AbortSignal): Promise<string> {
    if (signal.aborted) throw new Error("Discord delivery aborted");
    const channel = await this.#client.channels.fetch(context.threadId ?? context.channelId);
    if (channel === null || !channel.isTextBased() || !("send" in channel) || typeof channel.send !== "function") throw new Error("Discord reply channel is unavailable");
    const sent = await channel.send({ content, ...(context.messageId === undefined ? {} : { reply: { messageReference: context.messageId, failIfNotExists: false } }), allowedMentions: { repliedUser: false } });
    return sent.id;
  }
}
