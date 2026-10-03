import { assertBotStartConfig, loadConfig, type AppConfig } from "../config/config.js";

export type BotStartArguments = { readonly environmentFile?: string };

export function parseBotStartArguments(args: readonly string[]): BotStartArguments {
  if (args.length === 0) return {};
  if (args.length === 2 && args[0] === "--env-file" && args[1] !== undefined && args[1].trim() !== "") return { environmentFile: args[1] };
  throw new Error("Usage: bot:start [--env-file <path>]");
}

export async function loadBotStartConfig(args: readonly string[], options: { readonly cwd?: string; readonly environment?: NodeJS.ProcessEnv } = {}): Promise<AppConfig> {
  const parsed = parseBotStartArguments(args);
  const config = await loadConfig({ ...options, ...(parsed.environmentFile === undefined ? {} : { environmentFile: parsed.environmentFile }) });
  assertBotStartConfig(config);
  return config;
}
