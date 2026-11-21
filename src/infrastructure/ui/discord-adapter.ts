import type { Clock, IdGenerator, MessageQueue } from "../../application/ports.js";
import type { MessageEnvelope } from "../../domain/contracts.js";
import { noopLogger, type Logger } from "../../observability/logger.js";
import type { AgentPeer } from "../../config/agent-peers.js";

export type DiscordInboundMessage = { readonly id: string; readonly authorId: string; readonly isBot: boolean; readonly guildId?: string; readonly channelId: string; readonly threadId?: string; readonly referencedMessageId?: string; readonly content: string; readonly createdAt: Date };
export type DiscordReplyContext = { readonly channelId: string; readonly threadId?: string; readonly messageId?: string };
export interface DiscordGateway {
  start(handler: (message: DiscordInboundMessage) => Promise<void>, signal: AbortSignal): Promise<void>;
  startTyping(context: DiscordReplyContext, signal: AbortSignal): Promise<() => void>;
  send(context: DiscordReplyContext, content: string, idempotencyKey: string, signal: AbortSignal): Promise<string>;
}
export type DiscordAdapterOptions = { readonly gateway: DiscordGateway; readonly queue: MessageQueue; readonly clock: Clock; readonly ids: IdGenerator; readonly agentId: string; readonly botUserId: string; readonly ownerIds: ReadonlySet<string>; readonly peers?: readonly AgentPeer[]; readonly peerDiscordUserIds?: ReadonlySet<string>; readonly guildIds: ReadonlySet<string>; readonly channelIds: ReadonlySet<string>; readonly queueDestination?: string; readonly logger?: Logger };

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export class DiscordAdapter {
  readonly #seen = new Set<string>();
  readonly #actionByDiscordMessage = new Map<string, string>();
  readonly #stopTypingByMessage = new Map<string, () => void>();
  readonly #destination: string;
  constructor(private readonly options: DiscordAdapterOptions) { this.#destination = options.queueDestination ?? "discord"; }
  #peer(authorId: string): AgentPeer | undefined {
    const configured = this.options.peers?.filter((peer) => peer.discordUserId === authorId) ?? [];
    if (configured.length > 1) return undefined;
    if (configured.length === 1) return configured[0];
    return (this.options.peerDiscordUserIds ?? new Set<string>()).has(authorId) ? { agentId: authorId, displayName: authorId, discordUserId: authorId, channelId: "" } : undefined;
  }
  async startInbound(signal: AbortSignal): Promise<void> {
    try { await this.options.gateway.start(async (message) => {
      const mention = new RegExp(`<@!?${escapeRegExp(this.options.botUserId)}>`, "gu");
      const direct = mention.test(message.content);
      const peer = message.isBot ? this.#peer(message.authorId) : undefined;
      if ((message.isBot && (message.authorId === this.options.botUserId || peer === undefined)) || (!message.isBot && (!direct || !this.options.ownerIds.has(message.authorId))) || !this.options.channelIds.has(message.channelId) || (message.guildId !== undefined && !this.options.guildIds.has(message.guildId)) || this.#seen.has(message.id)) return;
      // Human input is direct-only. An allowlisted peer is observable even
      // without a mention, but a direct mention is never emitted twice.
      const addressing = direct ? "direct" as const : "observed" as const;
      const content = message.content.replace(mention, " ").replace(/\s+/gu, " ").trim() || "メンションされました";
      this.#seen.add(message.id); const now = this.options.clock.now();
      (this.options.logger ?? noopLogger).log("info", "discord.message_accepted", { agentId: this.options.agentId, discordMessageId: message.id, channelId: message.channelId, senderKind: message.isBot ? "peer" : "human", addressing });
      const causationId = message.referencedMessageId === undefined ? undefined : this.#actionByDiscordMessage.get(message.referencedMessageId);
      const replyContext = { channelId: message.channelId, ...(message.threadId === undefined ? {} : { threadId: message.threadId }), messageId: message.id };
      try {
        if (addressing !== "direct") throw new Error("typing-not-required");
        const stopTyping = await this.options.gateway.startTyping(replyContext, signal);
        this.#stopTypingByMessage.set(message.id, stopTyping);
      } catch (error) {
        if (addressing === "direct") (this.options.logger ?? noopLogger).log("warn", "discord.typing_start_failed", { agentId: this.options.agentId, discordMessageId: message.id, error: error instanceof Error ? error.message : String(error) });
      }
      try { await this.options.queue.publish({ id: `discord:${message.id}`, destination: this.options.agentId, source: this.#destination, replyTo: this.#destination, ...(causationId === undefined ? {} : { causationId }), sentAt: message.createdAt.toISOString(), availableAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), attempt: 0, hop: 0, payload: { type: "message-received", text: content, senderKind: message.isBot ? "peer" : "human", addressing, actorId: message.authorId, ...(peer === undefined ? {} : { peerName: peer.displayName }), sourceType: "discord", sourceId: message.channelId, ...(causationId === undefined ? {} : { resultOfActionId: causationId }), replyContext } }); }
      catch (error) { this.#stopTyping(message.id); throw error; }
    }, signal); }
    finally { for (const messageId of this.#stopTypingByMessage.keys()) this.#stopTyping(messageId); }
  }
  startOutbound(signal: AbortSignal): Promise<void> {
    return this.options.queue.subscribe(this.#destination, async (envelope: MessageEnvelope) => {
      const payload = envelope.payload; const context = payload.replyContext;
      if (payload.type !== "agent-response" || typeof payload.text !== "string" || typeof context !== "object" || context === null || !("channelId" in context) || typeof context.channelId !== "string" || !this.options.channelIds.has(context.channelId)) throw new Error("Invalid Discord output envelope");
      const record = context as Record<string, unknown>;
      const peer = typeof payload.peer === "object" && payload.peer !== null ? payload.peer as Record<string, unknown> : undefined;
      const peerId = typeof peer?.discordUserId === "string" ? peer.discordUserId : undefined;
      const configuredPeer = peerId === undefined ? undefined : this.#peer(peerId);
      if (peerId !== undefined && (peerId === this.options.botUserId || configuredPeer === undefined || (configuredPeer.channelId !== "" && configuredPeer.channelId !== context.channelId))) throw new Error("Invalid Discord peer output envelope");
      const outbound = peerId === undefined ? payload.text : `<@${peerId}> ${payload.text}`;
      const discordMessageId = await this.options.gateway.send({ channelId: context.channelId, ...(typeof record.threadId === "string" ? { threadId: record.threadId } : {}), ...(typeof record.messageId === "string" ? { messageId: record.messageId } : {}) }, outbound, envelope.id, signal);
      if (typeof record.messageId === "string") this.#stopTyping(record.messageId);
      (this.options.logger ?? noopLogger).log("info", "discord.message_delivered", { agentId: this.options.agentId, messageId: envelope.id, discordMessageId, channelId: context.channelId });
      const action = typeof payload.action === "object" && payload.action !== null ? payload.action as Record<string, unknown> : undefined;
      if (typeof action?.id === "string") this.#actionByDiscordMessage.set(discordMessageId, action.id);
    }, signal);
  }
  #stopTyping(messageId: string): void {
    this.#stopTypingByMessage.get(messageId)?.();
    this.#stopTypingByMessage.delete(messageId);
  }
}
