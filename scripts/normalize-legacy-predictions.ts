import { Pool } from "pg";

import { normalizeLegacyPredictionRecords } from "../src/application/legacy-prediction-normalization.js";

type Options = { readonly agentId?: string; readonly apply: boolean };

function options(arguments_: readonly string[]): Options {
  let agentId: string | undefined; let apply = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const value = arguments_[index];
    if (value === "--") continue;
    if (value === "--apply") { apply = true; continue; }
    if (value === "--agent-id") {
      const candidate = arguments_[index + 1];
      if (candidate === undefined || candidate.trim() === "") throw new Error("--agent-id requires a value");
      agentId = candidate; index += 1; continue;
    }
    throw new Error("Usage: pnpm prediction:normalize [--agent-id <id>] --apply");
  }
  return { ...(agentId === undefined ? {} : { agentId }), apply };
}

async function main(): Promise<void> {
  const input = options(process.argv.slice(2));
  if (!input.apply) throw new Error("Refusing to modify rows without --apply");
  const connectionString = (process.env.POSTGRES_URL ?? "").replace("postgresql+psycopg://", "postgresql://");
  if (connectionString === "") throw new Error("POSTGRES_URL is required");
  const pool = new Pool({ connectionString });
  try {
    const updated = await normalizeLegacyPredictionRecords(pool, input.agentId);
    process.stdout.write(`Normalized ${String(updated)} legacy Prediction record(s).\n`);
  } finally { await pool.end(); }
}

void main();
