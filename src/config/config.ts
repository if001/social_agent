import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parse } from "dotenv";
import { z } from "zod";

const HttpUrl = z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol), "must use HTTP(S)");
const ConfigSchema = z.object({
  BOT_ID: z.string().min(1),
  POSTGRES_URL: z.string().min(1),
  ADMIN_POSTGRES_URL: z.string().min(1),
  SIMPLE_CLIENT_BASE_URL: HttpUrl,
  OLLAMA_BASE_URL: HttpUrl,
  OLLAMA_API_KEY: z.string().min(1),
  OLLAMA_CHAT_MODEL: z.string().min(1),
  OLLAMA_EMBEDDING_BASE_URL: HttpUrl,
  OLLAMA_EMBEDDING_MODEL: z.string().min(1),
  OLLAMA_EMBEDDING_DIMENSION: z.coerce.number().int().positive().max(65_535),
  DISCORD_BOT_TOKEN: z.string().optional(),
  DISCORD_CHANNEL_ID: z.string().optional(),
  DISCORD_BOT_USER_ID: z.string().optional(),
  QUEUE_ROOT: z.string().default("./var/queue"),
  FILE_TOOL_ROOTS: z.string().default("./var/files"),
  RUN_DEADLINE_MS: z.coerce.number().int().positive().default(120_000)
}).superRefine((value, context) => {
  if (value.OLLAMA_BASE_URL === value.OLLAMA_EMBEDDING_BASE_URL) {
    context.addIssue({ code: "custom", path: ["OLLAMA_EMBEDDING_BASE_URL"], message: "chat and embedding endpoints must be separate" });
  }
  const discordValues = [value.DISCORD_BOT_TOKEN, value.DISCORD_CHANNEL_ID, value.DISCORD_BOT_USER_ID];
  if (discordValues.some(Boolean) && !discordValues.every(Boolean)) {
    context.addIssue({ code: "custom", path: ["DISCORD_BOT_TOKEN"], message: "Discord settings must be supplied together" });
  }
});

export type AppConfig = {
  readonly botId: string;
  readonly database: { readonly url: string; readonly adminUrl: string };
  readonly chat: { readonly baseUrl: string; readonly apiKey: string; readonly model: string };
  readonly embedding: { readonly baseUrl: string; readonly model: string; readonly dimension: number };
  readonly web: { readonly baseUrl: string };
  readonly discord?: { readonly token: string; readonly channelId: string; readonly botUserId: string };
  readonly queueRoot: string;
  readonly fileToolRoots: readonly string[];
  readonly runDeadlineMs: number;
};

async function readEnvironmentFile(path: string): Promise<Record<string, string>> {
  try { return parse(await readFile(path)); } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
}

export async function loadConfig(options: { readonly cwd?: string; readonly environment?: NodeJS.ProcessEnv } = {}): Promise<AppConfig> {
  const cwd = options.cwd ?? process.cwd();
  const sample = await readEnvironmentFile(resolve(cwd, ".env.sample"));
  const local = await readEnvironmentFile(resolve(cwd, ".env"));
  const value = ConfigSchema.parse({ ...sample, ...local, ...(options.environment ?? process.env) });
  return {
    botId: value.BOT_ID,
    database: { url: value.POSTGRES_URL, adminUrl: value.ADMIN_POSTGRES_URL },
    chat: { baseUrl: value.OLLAMA_BASE_URL, apiKey: value.OLLAMA_API_KEY, model: value.OLLAMA_CHAT_MODEL },
    embedding: { baseUrl: value.OLLAMA_EMBEDDING_BASE_URL, model: value.OLLAMA_EMBEDDING_MODEL, dimension: value.OLLAMA_EMBEDDING_DIMENSION },
    web: { baseUrl: value.SIMPLE_CLIENT_BASE_URL },
    ...(value.DISCORD_BOT_TOKEN !== undefined && value.DISCORD_CHANNEL_ID !== undefined && value.DISCORD_BOT_USER_ID !== undefined
      ? { discord: { token: value.DISCORD_BOT_TOKEN, channelId: value.DISCORD_CHANNEL_ID, botUserId: value.DISCORD_BOT_USER_ID } } : {}),
    queueRoot: resolve(cwd, value.QUEUE_ROOT),
    fileToolRoots: value.FILE_TOOL_ROOTS.split(",").map((root) => resolve(cwd, root.trim())),
    runDeadlineMs: value.RUN_DEADLINE_MS
  };
}
