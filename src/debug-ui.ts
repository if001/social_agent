import { readFile } from "node:fs/promises";

import { parse } from "dotenv";
import { Pool, type QueryResultRow } from "pg";

import { DebugUiRepository } from "./debug-ui/repository.js";
import { createDebugUiServer } from "./debug-ui/server.js";

function argument(name: string): string | undefined { const index = process.argv.indexOf(name); return index < 0 ? undefined : process.argv[index + 1]; }
const environmentFile = argument("--env-file");
const fileEnvironment = environmentFile === undefined ? {} : parse(await readFile(environmentFile));
const environment = { ...fileEnvironment, ...process.env };
const databaseUrl = environment.POSTGRES_URL?.replace("postgresql+psycopg://", "postgresql://");
if (databaseUrl === undefined || databaseUrl.trim() === "") throw new Error("POSTGRES_URL is required");
const host = environment.DEBUG_UI_HOST?.trim() || "127.0.0.1";
const port = Number(environment.DEBUG_UI_PORT ?? "4310");
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error("DEBUG_UI_PORT must be an integer from 1 to 65535");
const pool = new Pool({ connectionString: databaseUrl });
const repository = new DebugUiRepository(async <T extends QueryResultRow>(sql: string, values: readonly unknown[] = []) => (await pool.query<T>(sql, [...values])).rows);
const server = createDebugUiServer(repository);
const stop = (): void => { server.close(() => { void pool.end(); }); };
process.once("SIGINT", stop); process.once("SIGTERM", stop);
server.listen(port, host, () => { process.stdout.write(`Agent Debug UI: http://${host}:${String(port)}\n`); });
