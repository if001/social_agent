import { Pool } from "pg";
import { OllamaEmbeddingProvider } from "./infrastructure/embedding/ollama-embedding.js";
import { PostgresMemoryEmbeddingLifecycle } from "./infrastructure/persistence/postgres-memory-embedding.js";
import { AddressedFileQueue } from "./infrastructure/queue/addressed-file-queue.js";
import { initializeAgent, listDeadLetters, requeueDeadLetter } from "./operations/operations.js";
import { loadInitialSelfFile } from "./config/initial-self.js";
import { parseSchedulerTimings } from "./config/config.js";

const [command, ...args] = process.argv.slice(2);
const databaseUrl = (process.env.POSTGRES_URL ?? "").replace("postgresql+psycopg://", "postgresql://");

async function main(): Promise<void> {
  if (command === "agent:init") { const [configPath, option] = args; if (configPath === undefined || args.length > 2 || (option !== undefined && option !== "--overwrite-configured-self")) throw new Error("Usage: agent:init <initial-self-yaml> [--overwrite-configured-self]"); const config = await loadInitialSelfFile(configPath); const pool = new Pool({ connectionString: databaseUrl }); try { await initializeAgent(pool, config, parseSchedulerTimings(process.env), { overwriteConfiguredSelf: option === "--overwrite-configured-self" }); } finally { await pool.end(); } return; }
  if (command === "memory:backfill") {
    const [agentId, rawLimit] = args; const limit = rawLimit === undefined ? 100 : Number.parseInt(rawLimit, 10);
    const baseUrl = process.env.OLLAMA_EMBEDDING_BASE_URL; const model = process.env.OLLAMA_EMBEDDING_MODEL; const dimension = Number.parseInt(process.env.OLLAMA_EMBEDDING_DIMENSION ?? "", 10);
    if (baseUrl === undefined || model === undefined || !Number.isInteger(dimension) || dimension <= 0) throw new Error("OLLAMA_EMBEDDING_BASE_URL, OLLAMA_EMBEDDING_MODEL and OLLAMA_EMBEDDING_DIMENSION are required");
    if (!Number.isInteger(limit) || limit <= 0) throw new Error("Usage: memory:backfill [agent-id] [positive-limit]");
    const pool = new Pool({ connectionString: databaseUrl });
    try {
      const lifecycle = new PostgresMemoryEmbeddingLifecycle(pool, new OllamaEmbeddingProvider({ baseUrl, model, dimension }), model);
      process.stdout.write(`${JSON.stringify(await lifecycle.backfill({ ...(agentId === undefined ? {} : { agentId }), limit, signal: AbortSignal.timeout(120_000) }))}\n`);
    } finally { await pool.end(); }
    return;
  }
  if (command === "dead:list") { const [root, destination] = args; if (root === undefined || destination === undefined) throw new Error("Usage: dead:list <queue-root> <destination>"); process.stdout.write(`${JSON.stringify(await listDeadLetters(new AddressedFileQueue(root), destination), null, 2)}\n`); return; }
  if (command === "dead:requeue") { const [root, destination, file] = args; if (root === undefined || destination === undefined || file === undefined) throw new Error("Usage: dead:requeue <queue-root> <destination> <file>"); await requeueDeadLetter(new AddressedFileQueue(root), destination, file); return; }
  throw new Error("Commands: agent:init | memory:backfill | dead:list | dead:requeue");
}

void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Operation failed"}\n`); process.exitCode = 1; });
