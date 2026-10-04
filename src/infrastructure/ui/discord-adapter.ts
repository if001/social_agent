import type { Clock, IdGenerator, MessageQueue } from "../../application/ports.js";
import type { MessageEnvelope } from "../../domain/contracts.js";

export type DiscordInboundMessage = { readonly id: string; readonly authorId: string; readonly isBot: boolean; readonly guildId?: string; readonly channelId: string; readonly threadId?: string; readonly referencedMessageId?: string; readonly content: string; readonly createdAt: Date };
export type DiscordReplyContext = { readonly channelId: string; readonly threadId?: string; readonly messageId: string };
export interface DiscordGateway {
  start(handler: (message: DiscordInboundMessage) => Promise<void>, signal: AbortSignal): Promise<void>;
  send(context: DiscordReplyContext, content: string, idempotencyKey: string, signal: AbortSignal): Promise<string>;
}
export type DiscordAdapterOptions = { readonly gateway: DiscordGateway; readonly queue: MessageQueue; readonly clock: Clock; readonly ids: IdGenerator; readonly agentId: string; readonly botUserId: string; readonly ownerIds: ReadonlySet<string>; readonly guildIds: ReadonlySet<string>; readonly channelIds: ReadonlySet<string>; readonly queueDestination?: string };

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export class DiscordAdapter {
  readonly #seen = new Set<string>();
  readonly #actionByDiscordMessage = new Map<string, string>();
  readonly #destination: string;
  constructor(private readonly options: DiscordAdapterOptions) { this.#destination = options.queueDestination ?? "discord"; }
  startInbound(signal: AbortSignal): Promise<void> {
    return this.options.gateway.start(async (message) => {
      const mention = new RegExp(`<@!?${escapeRegExp(this.options.botUserId)}>`, "gu");
      if (!mention.test(message.content) || (message.isBot && message.authorId === this.options.botUserId) || (!message.isBot && !this.options.ownerIds.has(message.authorId)) || !this.options.channelIds.has(message.channelId) || (message.guildId !== undefined && !this.options.guildIds.has(message.guildId)) || this.#seen.has(message.id)) return;
      const content = message.content.replace(mention, " ").replace(/\s+/gu, " ").trim() || "メンションされました";
      this.#seen.add(message.id); const now = this.options.clock.now();
      const causationId = message.referencedMessageId === undefined ? undefined : this.#actionByDiscordMessage.get(message.referencedMessageId);
      await this.options.queue.publish({ id: `discord:${message.id}`, destination: this.options.agentId, source: this.#destination, replyTo: this.#destination, ...(causationId === undefined ? {} : { causationId }), sentAt: message.createdAt.toISOString(), availableAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), attempt: 0, hop: 0, payload: { type: "user-message", text: content, actorId: message.authorId, actorType: message.isBot ? "agent" : "human", sourceType: "discord", sourceId: message.channelId, ...(causationId === undefined ? {} : { resultOfActionId: causationId }), replyContext: { channelId: message.channelId, ...(message.threadId === undefined ? {} : { threadId: message.threadId }), messageId: message.id } } });
    }, signal);
  }
  startOutbound(signal: AbortSignal): Promise<void> {
    return this.options.queue.subscribe(this.#destination, async (envelope: MessageEnvelope) => {
      const payload = envelope.payload; const context = payload.replyContext;
      if (payload.type !== "agent-response" || typeof payload.text !== "string" || typeof context !== "object" || context === null || !("channelId" in context) || typeof context.channelId !== "string" || !("messageId" in context) || typeof context.messageId !== "string") throw new Error("Invalid Discord output envelope");
      const record = context as Record<string, unknown>;
      const discordMessageId = await this.options.gateway.send({ channelId: context.channelId, ...(typeof record.threadId === "string" ? { threadId: record.threadId } : {}), messageId: context.messageId }, payload.text, envelope.id, signal);
      const action = typeof payload.action === "object" && payload.action !== null ? payload.action as Record<string, unknown> : undefined;
      if (typeof action?.id === "string") this.#actionByDiscordMessage.set(discordMessageId, action.id);
    }, signal);
  }
}
