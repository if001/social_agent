import { Pool } from "pg";

import { parseMemoryEvidenceNormalizationOptions } from "../src/application/memory-evidence-normalization-cli.js";
import { normalizeOverfullMemoryEvidence } from "../src/application/memory-evidence-normalization.js";

async function main(): Promise<void> {
  const input = parseMemoryEvidenceNormalizationOptions(process.argv.slice(2));
  const connectionString = (process.env.POSTGRES_URL ?? "").replace("postgresql+psycopg://", "postgresql://");
  if (connectionString === "") throw new Error("POSTGRES_URL is required");
  const pool = new Pool({ connectionString, options: "-c search_path=app,public,ext" });
  try {
    const result = await normalizeOverfullMemoryEvidence(pool, input);
    process.stdout.write(`${JSON.stringify({ ...result, apply: input.apply, ...(input.agentId === undefined ? {} : { agentId: input.agentId }) })}\n`);
  } finally { await pool.end(); }
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : "Memory evidence normalization failed"}\n`);
  process.exitCode = 1;
});
