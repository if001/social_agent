import { Pool } from "pg";

import { DiscordPageIngestor } from "../application/discord-page-ingestor.js";
import type { AppConfig } from "../config/config.js";
import { createOllamaWebPageSummarizer } from "../infrastructure/agent/web-summary-harness.js";
import { OllamaEmbeddingProvider } from "../infrastructure/embedding/ollama-embedding.js";
import { PostgresWebArchive } from "../infrastructure/persistence/postgres-web-archive.js";
import { UuidGenerator } from "../infrastructure/system.js";
import { fetchWebPages } from "../infrastructure/tools/web-tools.js";
import { DiscordJsGateway } from "../infrastructure/ui/discord-js-gateway.js";
import { createStdoutLogger } from "../observability/logger.js";

export async function runPageIngestHost(config: AppConfig, signal: AbortSignal): Promise<void> {
  if (config.discord === undefined) throw new Error("Discord configuration is required");
  const pool = new Pool({ connectionString: config.database.url.replace("postgresql+psycopg://", "postgresql://") });
  const logger = createStdoutLogger({ botId: config.botId, agentId: config.botId, process: "page-ingest" });
  const gateway = new DiscordJsGateway(config.discord.token, logger);
  const archive = new PostgresWebArchive(pool, new OllamaEmbeddingProvider(config.embedding), createOllamaWebPageSummarizer(config.chat, logger), new UuidGenerator(), () => new Date(), config.embedding.model, config.webArchiveRoot);
  const ingestor = new DiscordPageIngestor({ gateway, archive, fetchPage: (url, requestSignal) => fetchWebPages(config.web.baseUrl, url, requestSignal), agentId: config.botId, botUserId: config.discord.botUserId, ownerIds: new Set(config.discord.ownerIds), guildIds: new Set(config.discord.guildIds), channelIds: new Set(config.discord.channelIds), logger });
  logger.log("info", "page_ingest.starting", { ownerCount: config.discord.ownerIds.length, guildCount: config.discord.guildIds.length, channelCount: config.discord.channelIds.length, webBaseUrl: config.web.baseUrl, webArchiveRoot: config.webArchiveRoot });
  try { await ingestor.start(signal); }
  finally { await pool.end(); logger.log("info", "page_ingest.stopped"); }
}
