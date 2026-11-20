import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "dotenv";
import { z } from "zod";

import type { BotPersona } from "../domain/contracts.js";
import { loadPersonaFile } from "./persona.js";
import { loadExplorationDomainCatalog } from "./exploration-domains.js";
import { loadAgentPeersFile, type AgentPeers } from "./agent-peers.js";

const HttpUrl = z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "must use HTTP(S)");
const OptionalText = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, z.string().min(1).optional());
const QuietHoursSchema = z.preprocess((value) => typeof value === "string" && value.trim() === "" ? undefined : value, z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d-(?:[01]\d|2[0-3]):[0-5]\d$/u, "must be HH:MM-HH:MM").optional());
const TimeZoneSchema = z.string().default("Asia/Tokyo").refine((value) => { try { new Intl.DateTimeFormat("en-US", { timeZone: value }).format(); return true; } catch { return false; } }, "invalid IANA time zone");
export const SchedulerTimingsSchema = z.object({
  SCHEDULER_INTERVAL_MS: z.coerce.number().int().positive().default(30_000),
  AUTONOMY_REVIEW_INTERVAL_MS: z.coerce.number().int().positive().default(86_400_000),
  CONCERN_FORMATION_INTERVAL_MS: z.coerce.number().int().positive().default(86_400_000),
  STATE_REVIEW_INTERVAL_MS: z.coerce.number().int().positive().default(86_400_000),
  CONCERN_STALE_AFTER_MS: z.coerce.number().int().positive().default(2_592_000_000),
  CONCERN_STALE_MIN_REFLECTION_SESSIONS: z.coerce.number().int().positive().default(2),
  SCHEDULER_RETRY_DELAY_MS: z.coerce.number().int().positive().default(300_000),
  SCHEDULER_LEASE_MS: z.coerce.number().int().positive().default(60_000),
  AUTONOMY_IDLE_QUIET_HOURS: QuietHoursSchema,
  AUTONOMY_IDLE_QUIET_TIME_ZONE: TimeZoneSchema
});
export type SchedulerTimings = {
  readonly scanIntervalMs: number;
  readonly autonomyReviewIntervalMs: number;
  readonly concernFormationIntervalMs: number;
  readonly stateReviewIntervalMs: number;
  readonly concernStaleAfterMs: number;
  readonly concernStaleMinReflectionSessions: number;
  readonly retryDelayMs: number;
  readonly leaseMs: number;
  readonly idleQuietHours?: { readonly startMinutes: number; readonly endMinutes: number; readonly timeZone: string };
};
const minutesOf = (value: string): number => { const [hour, minute] = value.split(":").map(Number); return (hour ?? 0) * 60 + (minute ?? 0); };
export function parseSchedulerTimings(environment: Record<string, unknown>): SchedulerTimings {
  const value = SchedulerTimingsSchema.parse(environment);
  const quiet = value.AUTONOMY_IDLE_QUIET_HOURS;
  const [start, end] = quiet === undefined ? [] : quiet.split("-");
  return { scanIntervalMs: value.SCHEDULER_INTERVAL_MS, autonomyReviewIntervalMs: value.AUTONOMY_REVIEW_INTERVAL_MS, concernFormationIntervalMs: value.CONCERN_FORMATION_INTERVAL_MS, stateReviewIntervalMs: value.STATE_REVIEW_INTERVAL_MS, concernStaleAfterMs: value.CONCERN_STALE_AFTER_MS, concernStaleMinReflectionSessions: value.CONCERN_STALE_MIN_REFLECTION_SESSIONS, retryDelayMs: value.SCHEDULER_RETRY_DELAY_MS, leaseMs: value.SCHEDULER_LEASE_MS, ...(start === undefined || end === undefined ? {} : { idleQuietHours: { startMinutes: minutesOf(start), endMinutes: minutesOf(end), timeZone: value.AUTONOMY_IDLE_QUIET_TIME_ZONE } }) };
}
const ConfigSchema = z.object({
  BOT_ID: z.string().min(1),
  BOT_PERSONA_FILE: OptionalText,
  POSTGRES_URL: z.string().min(1),
  ADMIN_POSTGRES_URL: z.string().min(1),
  SIMPLE_CLIENT_BASE_URL: HttpUrl,
  OLLAMA_BASE_URL: HttpUrl,
  OLLAMA_API_KEY: z.string().min(1),
  OLLAMA_CHAT_MODEL: z.string().min(1),
  OLLAMA_EMBEDDING_BASE_URL: HttpUrl,
  OLLAMA_EMBEDDING_MODEL: z.string().min(1),
  OLLAMA_EMBEDDING_DIMENSION: z.coerce.number().int().positive().max(65_535),
  DISCORD_BOT_TOKEN: OptionalText,
  DISCORD_CHANNEL_ID: OptionalText,
  DISCORD_BOT_USER_ID: OptionalText,
  DISCORD_OWNER_IDS: z.string().default(""),
  DISCORD_GUILD_IDS: z.string().default(""),
  DISCORD_CHANNEL_IDS: z.string().default(""),
  DISCORD_QUEUE_DESTINATION: OptionalText,
  DEFAULT_OUTPUT_DESTINATION: OptionalText,
  QUEUE_ROOT: z.string().default("./var/queue"),
  WEB_ARCHIVE_ROOT: z.string().default("./var/web-archive"),
  FILE_READ_ROOTS: z.string().default("./var/files"),
  FILE_WRITE_ROOTS: z.string().default("./var/files"),
  RUN_DEADLINE_MS: z.coerce.number().int().positive().default(120_000),
  RUNTIME_CORRELATION_TTL_MS: z.coerce.number().int().positive().default(604_800_000),
  RUNTIME_RATE_WINDOW_RETENTION_MS: z.coerce.number().int().positive().default(3_600_000),
  ...SchedulerTimingsSchema.shape,
  OUTBOX_INTERVAL_MS: z.coerce.number().int().positive().default(1_000)
}).superRefine((value, context) => {
  if (value.OLLAMA_BASE_URL === value.OLLAMA_EMBEDDING_BASE_URL) {
    context.addIssue({ code: "custom", path: ["OLLAMA_EMBEDDING_BASE_URL"], message: "chat and embedding endpoints must be separate" });
  }
  const discordEnabled = value.DISCORD_BOT_TOKEN !== undefined || value.DISCORD_BOT_USER_ID !== undefined || value.DISCORD_CHANNEL_ID !== undefined || value.DISCORD_CHANNEL_IDS.trim() !== "";
  const discordComplete = value.DISCORD_BOT_TOKEN !== undefined && value.DISCORD_BOT_USER_ID !== undefined && (value.DISCORD_CHANNEL_ID !== undefined || value.DISCORD_CHANNEL_IDS.trim() !== "");
  if (discordEnabled && !discordComplete) {
    context.addIssue({ code: "custom", path: ["DISCORD_BOT_TOKEN"], message: "Discord settings must be supplied together" });
  }
});

export type AppConfig = {
  readonly botId: string;
  readonly persona?: BotPersona;
  readonly explorationDomains: readonly string[];
  readonly peers: AgentPeers;
  readonly database: { readonly url: string; readonly adminUrl: string };
  readonly chat: { readonly baseUrl: string; readonly apiKey: string; readonly model: string };
  readonly embedding: { readonly baseUrl: string; readonly model: string; readonly dimension: number };
  readonly web: { readonly baseUrl: string };
  readonly discord?: { readonly token: string; readonly botUserId: string; readonly ownerIds: readonly string[]; readonly guildIds: readonly string[]; readonly channelIds: readonly string[]; readonly queueDestination: string };
  readonly defaultOutputDestination: string;
  readonly queueRoot: string;
  readonly webArchiveRoot: string;
  readonly fileReadRoots: readonly string[];
  readonly fileWriteRoots: readonly string[];
  readonly runDeadlineMs: number;
  readonly runtimeCorrelationTtlMs: number;
  readonly runtimeRateWindowRetentionMs: number;
  readonly schedulerTimings: SchedulerTimings;
  readonly outboxIntervalMs: number;
};

const list = (value: string): readonly string[] => [...new Set(value.split(",").map((item) => item.trim()).filter(Boolean))];
const paths = (cwd: string, value: string): readonly string[] => list(value).map((root) => resolve(cwd, root));

async function readEnvironmentFile(path: string): Promise<Record<string, string>> {
  try { return parse(await readFile(path)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function loadConfig(options: { readonly cwd?: string; readonly environment?: NodeJS.ProcessEnv; readonly environmentFile?: string } = {}): Promise<AppConfig> {
  const cwd = options.cwd ?? process.cwd();
  const sample = await readEnvironmentFile(resolve(cwd, ".env.sample"));
  const local = await readEnvironmentFile(resolve(cwd, ".env"));
  const processFile = options.environmentFile === undefined ? {} : await readEnvironmentFile(resolve(cwd, options.environmentFile));
  const value = ConfigSchema.parse({ ...sample, ...local, ...processFile, ...(options.environment ?? process.env) });
  const configuredPersonaPath = value.BOT_PERSONA_FILE === undefined ? undefined : resolve(cwd, value.BOT_PERSONA_FILE);
  const conventionalPersonaPath = resolve(cwd, "config", "personas", `${value.BOT_ID}.yaml`);
  let persona: BotPersona | undefined;
  try { persona = await loadPersonaFile(configuredPersonaPath ?? conventionalPersonaPath); }
  catch (error) {
    if (configuredPersonaPath !== undefined || (error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  let explorationDomains: readonly string[] = [];
  try { explorationDomains = (await loadExplorationDomainCatalog(resolve(cwd, "config", "exploration-domains.yaml"))).topics; }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  let peers: AgentPeers = { version: 1, agentId: value.BOT_ID, peers: [] };
  try { peers = await loadAgentPeersFile(resolve(cwd, "config", "agent-peers", `${value.BOT_ID}.yaml`), value.BOT_ID); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  const channelIds = list(value.DISCORD_CHANNEL_IDS || value.DISCORD_CHANNEL_ID || "");
  const ownerIds = list(value.DISCORD_OWNER_IDS); const guildIds = list(value.DISCORD_GUILD_IDS);
  return {
    botId: value.BOT_ID,
    ...(persona === undefined ? {} : { persona }),
    explorationDomains,
    peers,
    database: { url: value.POSTGRES_URL, adminUrl: value.ADMIN_POSTGRES_URL },
    chat: { baseUrl: value.OLLAMA_BASE_URL, apiKey: value.OLLAMA_API_KEY, model: value.OLLAMA_CHAT_MODEL },
    embedding: { baseUrl: value.OLLAMA_EMBEDDING_BASE_URL, model: value.OLLAMA_EMBEDDING_MODEL, dimension: value.OLLAMA_EMBEDDING_DIMENSION },
    web: { baseUrl: value.SIMPLE_CLIENT_BASE_URL },
    ...(value.DISCORD_BOT_TOKEN !== undefined && value.DISCORD_BOT_USER_ID !== undefined && channelIds.length > 0
      ? { discord: { token: value.DISCORD_BOT_TOKEN, botUserId: value.DISCORD_BOT_USER_ID, ownerIds, guildIds, channelIds, queueDestination: value.DISCORD_QUEUE_DESTINATION ?? `discord:${value.BOT_ID}` } } : {}),
    defaultOutputDestination: value.DEFAULT_OUTPUT_DESTINATION ?? `discord:${value.BOT_ID}`,
    queueRoot: resolve(cwd, value.QUEUE_ROOT),
    webArchiveRoot: resolve(cwd, value.WEB_ARCHIVE_ROOT),
    fileReadRoots: paths(cwd, value.FILE_READ_ROOTS),
    fileWriteRoots: paths(cwd, value.FILE_WRITE_ROOTS),
    runDeadlineMs: value.RUN_DEADLINE_MS,
    runtimeCorrelationTtlMs: value.RUNTIME_CORRELATION_TTL_MS,
    runtimeRateWindowRetentionMs: value.RUNTIME_RATE_WINDOW_RETENTION_MS,
    schedulerTimings: parseSchedulerTimings(value),
    outboxIntervalMs: value.OUTBOX_INTERVAL_MS
  };
}

export function assertDiscordStartConfig(config: AppConfig): void {
  if (config.discord === undefined) throw new Error("Discord configuration is required for bot:start");
  if (config.discord.ownerIds.length === 0) throw new Error("DISCORD_OWNER_IDS is required for bot:start");
  if (config.discord.channelIds.length === 0) throw new Error("DISCORD_CHANNEL_IDS or DISCORD_CHANNEL_ID is required for bot:start");
}

export function assertBotStartConfig(config: AppConfig): void {
  assertDiscordStartConfig(config);
  if (config.explorationDomains.length < 100) throw new Error("At least 100 exploration domains are required for bot:start");
}

export function assertDistinctBotConfigs(configs: readonly AppConfig[]): void {
  const botIds = configs.map(({ botId }) => botId); const destinations = configs.map(({ discord }) => discord?.queueDestination).filter((value): value is string => value !== undefined);
  if (new Set(botIds).size !== botIds.length) throw new Error("BOT_ID must be unique between bot processes");
  if (new Set(destinations).size !== destinations.length) throw new Error("DISCORD_QUEUE_DESTINATION must be unique between bot processes");
}
