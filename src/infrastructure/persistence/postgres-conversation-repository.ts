import { and, eq } from "drizzle-orm";

import type { ConversationTransportRepository } from "../ui/discord-adapter.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { conversationMessages, conversations } from "./schema.js";
import { conversationKey } from "./conversation-key.js";

export class PostgresConversationRepository implements ConversationTransportRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  async resolve(agentId: string, externalMessageId: string): Promise<{ readonly correlationId: string; readonly conversationId?: string } | undefined> {
    const row = (await this.database.db.select({ correlationId: conversationMessages.correlationId, conversationId: conversationMessages.conversationId, status: conversations.status })
      .from(conversationMessages)
      .leftJoin(conversations, eq(conversations.id, conversationMessages.conversationId))
      .where(and(eq(conversationMessages.agentId, agentId), eq(conversationMessages.externalMessageId, externalMessageId), eq(conversationMessages.direction, "outbound")))
      .limit(1))[0];
    if (row === undefined || (row.conversationId !== null && row.status !== "active")) return undefined;
    const correlationId = row.correlationId ?? row.conversationId;
    if (correlationId === null) return undefined;
    return { correlationId, ...(row.conversationId === null ? {} : { conversationId: row.conversationId }) };
  }

  async registerOutbound(agentId: string, externalMessageId: string, correlationId: string): Promise<void> {
    const existing = (await this.database.db.select({ id: conversations.id }).from(conversations)
      .where(and(eq(conversations.id, conversationKey(agentId, correlationId)), eq(conversations.agentId, agentId))).limit(1))[0];
    await this.database.db.insert(conversationMessages).values({ agentId, externalMessageId, conversationId: existing?.id, correlationId, direction: "outbound" }).onConflictDoNothing();
  }
}
