import { readdir } from "node:fs/promises";
import { resolve } from "node:path";
import { Pool } from "pg";
import { loadInitialSelfFile } from "./config/initial-self.js";
import { parseSchedulerTimings } from "./config/config.js";
import { resetRuntime } from "./operations/reset-runtime.js";

async function main(): Promise<void> {
  if (!process.argv.includes("--confirm")) throw new Error("Stop all bots, then run pnpm runtime:reset --confirm. This resets all agents in the configured database.");
  if (!process.env.POSTGRES_URL) throw new Error("POSTGRES_URL is required");
  const directory = resolve("config/initial-self");
  const configs = await Promise.all((await readdir(directory)).filter(name => /\.ya?ml$/.test(name)).map(name => loadInitialSelfFile(resolve(directory, name))));
  const roots = [process.env.QUEUE_ROOT ?? "./var/queue", process.env.WEB_ARCHIVE_ROOT ?? "./var/web-archive"];
  const pool = new Pool({ connectionString: process.env.POSTGRES_URL.replace("postgresql+psycopg://", "postgresql://"), connectionTimeoutMillis: 5000 });
  try { console.log(JSON.stringify(await resetRuntime(pool, configs, roots, parseSchedulerTimings(process.env)), null, 2)); }
  finally { await pool.end(); }
}
void main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Reset failed"); process.exitCode = 1; });
