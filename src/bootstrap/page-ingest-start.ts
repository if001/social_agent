import { assertBotStartConfig, loadConfig, type AppConfig } from "../config/config.js";

export type PageIngestStartArguments = { readonly environmentFile?: string };

export function parsePageIngestStartArguments(args: readonly string[]): PageIngestStartArguments {
  if (args.length === 0) return {};
  if (args.length === 2 && args[0] === "--env-file" && args[1] !== undefined && args[1].trim() !== "") return { environmentFile: args[1] };
  throw new Error("Usage: page-ingest:start [--env-file <path>]");
}

export async function loadPageIngestStartConfig(args: readonly string[], options: { readonly cwd?: string; readonly environment?: NodeJS.ProcessEnv } = {}): Promise<AppConfig> {
  const parsed = parsePageIngestStartArguments(args);
  const config = await loadConfig({ ...options, ...(parsed.environmentFile === undefined ? {} : { environmentFile: parsed.environmentFile }) });
  assertBotStartConfig(config);
  return config;
}
