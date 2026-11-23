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
export interface ConversationTransportRepository {
  resolve(agentId: string, externalMessageId: string): Promise<{ readonly correlationId: string; readonly conversationId?: string } | undefined>;
  registerOutbound(agentId: string, externalMessageId: string, correlationId: string): Promise<void>;
}
export type DiscordAdapterOptions = { readonly gateway: DiscordGateway; readonly queue: MessageQueue; readonly clock: Clock; readonly ids: IdGenerator; readonly agentId: string; readonly botUserId: string; readonly ownerIds: ReadonlySet<string>; readonly peers?: readonly AgentPeer[]; readonly peerDiscordUserIds?: ReadonlySet<string>; readonly guildIds: ReadonlySet<string>; readonly channelIds: ReadonlySet<string>; readonly conversationRepository?: ConversationTransportRepository; readonly queueDestination?: string; readonly logger?: Logger };
type OutboundDiscordTrace = { readonly actionId?: string; readonly correlationId?: string; readonly hop: number; readonly expiresAt: Date };

const escapeRegExp = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");

export class DiscordAdapter {
  readonly #seen = new Set<string>();
  readonly #outboundTraceByDiscordMessage = new Map<string, OutboundDiscordTrace>();
  readonly #stopTypingByMessage = new Map<string, () => void>();
  readonly #destination: string;
  constructor(private readonly options: DiscordAdapterOptions) { this.#destination = options.queueDestination ?? "discord"; }
  #peer(authorId: string): AgentPeer | undefined {
    const configured = this.options.peers?.filter((peer) => peer.discordUserId === authorId) ?? [];
    if (configured.length > 1) return undefined;
    if (configured.length === 1) return configured[0];
    return (this.options.peerDiscordUserIds ?? new Set<string>()).has(authorId) ? { agentId: authorId, displayName: authorId, discordUserId: authorId, channelId: "" } : undefined;
  }
  #pruneOutboundTraces(now: Date): void {
    for (const [messageId, trace] of this.#outboundTraceByDiscordMessage) if (trace.expiresAt.getTime() <= now.getTime()) this.#outboundTraceByDiscordMessage.delete(messageId);
  }
  #outboundTrace(messageId: string | undefined, now: Date): OutboundDiscordTrace | undefined {
    this.#pruneOutboundTraces(now);
    return messageId === undefined ? undefined : this.#outboundTraceByDiscordMessage.get(messageId);
  }
  async startInbound(signal: AbortSignal): Promise<void> {
    try { await this.options.gateway.start(async (message) => {
      const mention = new RegExp(`<@!?${escapeRegExp(this.options.botUserId)}>`, "gu");
      const mentioned = mention.test(message.content);
      const peer = message.isBot ? this.#peer(message.authorId) : undefined;
      const persistedConversation = message.referencedMessageId === undefined || this.options.conversationRepository === undefined ? undefined : await this.options.conversationRepository.resolve(this.options.agentId, message.referencedMessageId);
      const now = this.options.clock.now();
      const trace = this.#outboundTrace(message.referencedMessageId, now);
      const liveOnlyContinuation = this.options.conversationRepository === undefined && trace !== undefined;
      const continuation = persistedConversation !== undefined || liveOnlyContinuation;
      if ((message.isBot && (message.authorId === this.options.botUserId || peer === undefined)) || (!message.isBot && ((!mentioned && !continuation) || !this.options.ownerIds.has(message.authorId))) || !this.options.channelIds.has(message.channelId) || (message.guildId !== undefined && !this.options.guildIds.has(message.guildId)) || this.#seen.has(message.id)) return;
      const addressing = mentioned || continuation ? "direct" as const : "observed" as const;
      const content = message.content.replace(mention, " ").replace(/\s+/gu, " ").trim() || "メンションされました";
      this.#seen.add(message.id);
      (this.options.logger ?? noopLogger).log("info", "discord.message_accepted", { agentId: this.options.agentId, discordMessageId: message.id, channelId: message.channelId, senderKind: message.isBot ? "peer" : "human", addressing });
      const continuationTrace = persistedConversation !== undefined || this.options.conversationRepository === undefined ? trace : undefined;
      const causationId = continuationTrace?.actionId;
      const replyToOwnPost = continuationTrace !== undefined || continuation;
      const replyContext = { channelId: message.channelId, ...(message.threadId === undefined ? {} : { threadId: message.threadId }), messageId: message.id };
      try {
        if (addressing !== "direct") throw new Error("typing-not-required");
        const stopTyping = await this.options.gateway.startTyping(replyContext, signal);
        this.#stopTypingByMessage.set(message.id, stopTyping);
      } catch (error) {
        if (addressing === "direct") (this.options.logger ?? noopLogger).log("warn", "discord.typing_start_failed", { agentId: this.options.agentId, discordMessageId: message.id, error: error instanceof Error ? error.message : String(error) });
      }
      try { await this.options.queue.publish({ id: `discord:${message.id}`, destination: this.options.agentId, source: this.#destination, replyTo: this.#destination, ...(causationId === undefined ? {} : { causationId }), ...(persistedConversation !== undefined ? { correlationId: persistedConversation.correlationId } : replyToOwnPost && continuationTrace?.correlationId !== undefined ? { correlationId: continuationTrace.correlationId } : {}), sentAt: message.createdAt.toISOString(), availableAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), attempt: 0, hop: continuationTrace === undefined ? 0 : continuationTrace.hop + 1, payload: { type: "message-received", text: content, senderKind: message.isBot ? "peer" : "human", addressing, actorId: message.authorId, ...(peer === undefined ? {} : { peerName: peer.displayName }), sourceType: "discord", sourceId: message.channelId, ...(causationId === undefined ? {} : { resultOfActionId: causationId }), replyContext } }); }
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
      const user = typeof payload.user === "object" && payload.user !== null ? payload.user as Record<string, unknown> : undefined;
      const ownerId = typeof user?.discordUserId === "string" ? user.discordUserId : undefined;
      if (ownerId !== undefined && !this.options.ownerIds.has(ownerId)) throw new Error("Invalid Discord owner output envelope");
      // Legacy envelopes may still carry peer metadata, but Bot-to-Bot
      // delivery is always a Discord reply or an unmentioned channel post.
      // Never turn peer metadata into a mention.
      const outbound = ownerId === undefined ? payload.text : `<@${ownerId}> ${payload.text}`;
      const discordMessageId = await this.options.gateway.send({ channelId: context.channelId, ...(typeof record.threadId === "string" ? { threadId: record.threadId } : {}), ...(typeof record.messageId === "string" ? { messageId: record.messageId } : {}) }, outbound, envelope.id, signal);
      this.#pruneOutboundTraces(this.options.clock.now());
      const action = typeof payload.action === "object" && payload.action !== null ? payload.action as Record<string, unknown> : undefined;
      this.#outboundTraceByDiscordMessage.set(discordMessageId, { ...(typeof action?.id === "string" ? { actionId: action.id } : {}), ...(envelope.correlationId === undefined ? {} : { correlationId: envelope.correlationId }), hop: envelope.hop, expiresAt: new Date(envelope.expiresAt) });
      if (envelope.correlationId !== undefined) await this.options.conversationRepository?.registerOutbound(this.options.agentId, discordMessageId, envelope.correlationId);
      if (typeof record.messageId === "string") this.#stopTyping(record.messageId);
      (this.options.logger ?? noopLogger).log("info", "discord.message_delivered", { agentId: this.options.agentId, messageId: envelope.id, discordMessageId, channelId: context.channelId });
    }, signal);
  }
  #stopTyping(messageId: string): void {
    this.#stopTypingByMessage.get(messageId)?.();
    this.#stopTypingByMessage.delete(messageId);
  }
}
