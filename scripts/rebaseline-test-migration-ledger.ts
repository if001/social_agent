import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { Pool } from "pg";

const migrationTimestamp = 1_794_662_755_884;
const migrationFile = "0040_military_marvel_zombies.sql";

function usage(): never { throw new Error("Usage: pnpm db:rebaseline:test-migrations -- --apply"); }

async function main(): Promise<void> {
  if (process.argv.slice(2).filter((value) => value !== "--").join(" ") !== "--apply") usage();
  const connectionString = process.env.TEST_ADMIN_POSTGRES_URL;
  if (connectionString === undefined || connectionString.trim() === "") throw new Error("TEST_ADMIN_POSTGRES_URL is required");
  const databaseName = new URL(connectionString.replace("postgresql+psycopg://", "postgresql://")).pathname.replace(/^\//u, "");
  if (!databaseName.endsWith("_test")) throw new Error("TEST_ADMIN_POSTGRES_URL must target a *_test database");

  const sql = await readFile(resolve(process.cwd(), "drizzle", migrationFile), "utf8");
  const hash = createHash("sha256").update(sql).digest("hex");
  const pool = new Pool({ connectionString });
  try {
    const columns = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM information_schema.columns WHERE table_schema='app' AND ((table_name='g3_tasks' AND column_name IN ('source_run_id','attempt','deadline_at','lease_until')) OR (table_name='memory_mutations' AND column_name IN ('candidate_memory_ids','source_run_id','source_kind','source_id','attempt','before','after','reason','evidence_event_ids','evidence_memory_ids','status','failure_reason','idempotency_key','applied_at')))`);
    const indexes = await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM pg_indexes WHERE schemaname='app' AND indexname IN ('memory_mutations_source_intent_idx','memory_mutations_source_attempt_uidx','prediction_evaluations_prediction_created_idx','prediction_records_source_run_created_idx','runtime_correlations_created_idx','runtime_rate_windows_start_idx')`);
    if (columns.rows[0]?.count !== "18" || indexes.rows[0]?.count !== "6") throw new Error("Test database is not at the verified post-0040 schema; refusing to rebaseline migration ledger");
    await pool.query("INSERT INTO app.__drizzle_migrations (hash, created_at) VALUES ($1, $2) ON CONFLICT DO NOTHING", [hash, migrationTimestamp]);
    process.stdout.write(`Recorded verified ${migrationFile} in the test migration ledger. Run: pnpm db:migrate:test\n`);
  } finally {
    await pool.end();
  }
}

void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Test migration ledger rebaseline failed"}\n`); process.exitCode = 1; });
