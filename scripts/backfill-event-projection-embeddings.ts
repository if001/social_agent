import { Pool } from "pg";

import { OllamaEmbeddingProvider } from "../src/infrastructure/embedding/ollama-embedding.js";

type Options = { readonly agentId?: string; readonly batchSize: number };
function options(args: readonly string[]): Options {
  let agentId: string | undefined; let batchSize = 100;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]; if (value === "--") continue;
    if (value === "--agent-id") { agentId = args[index + 1]; index += 1; continue; }
    if (value === "--batch-size") { batchSize = Number.parseInt(args[index + 1] ?? "", 10); index += 1; continue; }
    throw new Error("Usage: pnpm event:embed:migrate [--agent-id <id>] [--batch-size <positive-integer>]");
  }
  if (agentId !== undefined && agentId.trim() === "") throw new Error("--agent-id must not be empty");
  if (!Number.isInteger(batchSize) || batchSize <= 0 || batchSize > 1_000) throw new Error("--batch-size must be an integer between 1 and 1000");
  return { ...(agentId === undefined ? {} : { agentId }), batchSize };
}
async function main(): Promise<void> {
  const config = options(process.argv.slice(2)); const url = (process.env.POSTGRES_URL ?? "").replace("postgresql+psycopg://", "postgresql://");
  const baseUrl = process.env.OLLAMA_EMBEDDING_BASE_URL; const model = process.env.OLLAMA_EMBEDDING_MODEL; const dimension = Number.parseInt(process.env.OLLAMA_EMBEDDING_DIMENSION ?? "", 10);
  if (url === "" || baseUrl === undefined || model === undefined || !Number.isInteger(dimension) || dimension <= 0) throw new Error("POSTGRES_URL, OLLAMA_EMBEDDING_BASE_URL, OLLAMA_EMBEDDING_MODEL and OLLAMA_EMBEDDING_DIMENSION are required");
  const pool = new Pool({ connectionString: url }); const provider = new OllamaEmbeddingProvider({ baseUrl, model, dimension }); let attempted = 0; let ready = 0; let failed = 0;
  try { for (;;) {
    const rows = (await pool.query<{ event_id: string; content: string }>("SELECT p.event_id,x.summary || ' ' || x.facts::text AS content FROM event_projections p JOIN event_experiences x ON x.event_id=p.event_id JOIN events e ON e.id=p.event_id WHERE ($1::text IS NULL OR e.agent_id=$1) AND (p.embedding IS NULL OR p.embedding_status IN ('pending','failed')) ORDER BY p.created_at,p.event_id LIMIT $2", [config.agentId ?? null, config.batchSize])).rows;
    if (rows.length === 0) break;
    for (const row of rows) { attempted += 1; try { const vector = (await provider.embed([row.content], AbortSignal.timeout(120_000)))[0]; if (vector === undefined || vector.length !== dimension) throw new Error("Embedding provider returned an invalid vector"); await pool.query("UPDATE event_projections SET embedding=$2::vector,embedding_model=$3,embedding_dimension=$4,embedding_status='ready',embedding_error=NULL,embedding_last_attempt_at=now(),updated_at=now() WHERE event_id=$1", [row.event_id, `[${vector.join(",")}]`, model, dimension]); ready += 1; } catch { await pool.query("UPDATE event_projections SET embedding_status='failed',embedding_last_attempt_at=now(),updated_at=now() WHERE event_id=$1", [row.event_id]); failed += 1; } }
    if (failed > 0) break;
  } process.stdout.write(`${JSON.stringify({ ...(config.agentId === undefined ? {} : { agentId: config.agentId }), attempted, ready, failed })}\n`); if (failed > 0) process.exitCode = 1; } finally { await pool.end(); }
}
void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Event projection embedding migration failed"}\n`); process.exitCode = 1; });
