import { Pool } from "pg";

import { OllamaEmbeddingProvider } from "../src/infrastructure/embedding/ollama-embedding.js";
import { PostgresMemoryEmbeddingLifecycle } from "../src/infrastructure/persistence/postgres-memory-embedding.js";

type Options = { readonly agentId?: string; readonly batchSize: number };

function options(args: readonly string[]): Options {
  let agentId: string | undefined;
  let batchSize = 100;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") continue;
    if (value === "--agent-id") { agentId = args[index + 1]; index += 1; continue; }
    if (value === "--batch-size") { batchSize = Number.parseInt(args[index + 1] ?? "", 10); index += 1; continue; }
    throw new Error("Usage: pnpm memory:embed:migrate [--agent-id <id>] [--batch-size <positive-integer>]");
  }
  if (agentId !== undefined && agentId.trim() === "") throw new Error("--agent-id must not be empty");
  if (!Number.isInteger(batchSize) || batchSize <= 0 || batchSize > 1_000) throw new Error("--batch-size must be an integer between 1 and 1000");
  return { ...(agentId === undefined ? {} : { agentId }), batchSize };
}

async function main(): Promise<void> {
  const config = options(process.argv.slice(2));
  const databaseUrl = (process.env.POSTGRES_URL ?? "").replace("postgresql+psycopg://", "postgresql://");
  const baseUrl = process.env.OLLAMA_EMBEDDING_BASE_URL;
  const model = process.env.OLLAMA_EMBEDDING_MODEL;
  const dimension = Number.parseInt(process.env.OLLAMA_EMBEDDING_DIMENSION ?? "", 10);
  if (databaseUrl === "" || baseUrl === undefined || model === undefined || !Number.isInteger(dimension) || dimension <= 0) throw new Error("POSTGRES_URL, OLLAMA_EMBEDDING_BASE_URL, OLLAMA_EMBEDDING_MODEL and OLLAMA_EMBEDDING_DIMENSION are required");
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    const lifecycle = new PostgresMemoryEmbeddingLifecycle(pool, new OllamaEmbeddingProvider({ baseUrl, model, dimension }), model);
    let attempted = 0; let ready = 0; let failed = 0; let result;
    do {
      result = await lifecycle.backfill({ ...(config.agentId === undefined ? {} : { agentId: config.agentId }), limit: config.batchSize, signal: AbortSignal.timeout(120_000) });
      attempted += result.attempted; ready += result.ready; failed += result.failed;
    } while (result.attempted > 0 && result.failed === 0);
    process.stdout.write(`${JSON.stringify({ ...(config.agentId === undefined ? {} : { agentId: config.agentId }), attempted, ready, failed })}\n`);
    if (failed > 0) process.exitCode = 1;
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Memory embedding migration failed"}\n`);
  process.exitCode = 1;
});
