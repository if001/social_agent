import { Pool } from "pg";
import { randomUUID } from "node:crypto";

type Options = { readonly apply: boolean; readonly agentId?: string };
export type ConcernSignalMigrationResult = { readonly apply: boolean; readonly agentId: string | null; readonly concernDueSchedulesRemoved: number; readonly externalChangeSchedulesRemoved: number; readonly legacyBatchesCreated: number; readonly legacySourcesAttached: number };

export function parseConcernSignalMigrationOptions(args: readonly string[]): Options {
  let apply = false; let agentId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") continue;
    if (value === "--apply") { apply = true; continue; }
    if (value === "--agent-id") { agentId = args[index + 1]; index += 1; continue; }
    throw new Error("Usage: pnpm concern:signals:migrate [--agent-id <id>] [--apply]");
  }
  if (agentId !== undefined && agentId.trim() === "") throw new Error("--agent-id must not be empty");
  return { apply, ...(agentId === undefined ? {} : { agentId }) };
}

export async function migrateConcernReevaluationSignals(pool: Pool, options: Options): Promise<ConcernSignalMigrationResult> {
  const kinds = ["concern-due", "external-change"] as const;
  const counts = await Promise.all(kinds.map(async (kind) => ({ kind, count: Number.parseInt((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM app.autonomous_schedules WHERE kind=$1 AND ($2::text IS NULL OR agent_id=$2)", [kind, options.agentId ?? null])).rows[0]?.count ?? "0", 10) })));
  const signals = await pool.query<{ agent_id: string; reason: string }>("SELECT agent_id,reason FROM app.concern_reevaluation_signals WHERE ($1::text IS NULL OR agent_id=$1)", [options.agentId ?? null]);
  const sources = await pool.query<{ agent_id: string; source_id: string }>("SELECT agent_id,source_id FROM app.concern_reevaluation_signal_sources WHERE source_kind='memory' AND ($1::text IS NULL OR agent_id=$1)", [options.agentId ?? null]);
  let legacyBatchesCreated = 0; let legacySourcesAttached = 0;
  if (options.apply) await pool.query("BEGIN").then(async () => {
    try {
      for (const signal of signals.rows) {
        const id = randomUUID();
        const inserted = await pool.query("INSERT INTO app.concern_reevaluation_batches(id,agent_id,source_kind,source_id,status,impact_reason,created_at,updated_at) VALUES ($1,$2,'legacy-signal',$2,'discarded',$3,now(),now()) ON CONFLICT (agent_id,source_kind,source_id) DO NOTHING RETURNING id", [id, signal.agent_id, `旧signalをexperience batchへ移行。意味的Focus未解決のため再検討は起動しない: ${signal.reason}`]);
        const batchId = inserted.rows[0]?.id as string | undefined;
        if (batchId !== undefined) {
          legacyBatchesCreated += 1;
          for (const source of sources.rows.filter((item) => item.agent_id === signal.agent_id)) {
            const attached = await pool.query("INSERT INTO app.concern_reevaluation_batch_memories(batch_id,memory_id) SELECT $1,id FROM app.memories WHERE id=$2 AND agent_id=$3 ON CONFLICT DO NOTHING", [batchId, source.source_id, signal.agent_id]);
            legacySourcesAttached += attached.rowCount ?? 0;
          }
        }
      }
      await pool.query("DELETE FROM app.autonomous_schedules WHERE kind IN ('concern-due','external-change') AND ($1::text IS NULL OR agent_id=$1)", [options.agentId ?? null]);
      await pool.query("COMMIT");
    } catch (error) { await pool.query("ROLLBACK"); throw error; }
  });
  return {
    apply: options.apply,
    agentId: options.agentId ?? null,
    concernDueSchedulesRemoved: counts.find(({ kind }) => kind === "concern-due")?.count ?? 0,
    externalChangeSchedulesRemoved: counts.find(({ kind }) => kind === "external-change")?.count ?? 0,
    legacyBatchesCreated,
    legacySourcesAttached
  };
}

async function main(): Promise<void> {
  const options = parseConcernSignalMigrationOptions(process.argv.slice(2));
  const url = (process.env.ADMIN_POSTGRES_URL ?? "").replace("postgresql+psycopg://", "postgresql://");
  if (url === "") throw new Error("ADMIN_POSTGRES_URL is required");
  const pool = new Pool({ connectionString: url });
  try { process.stdout.write(`${JSON.stringify(await migrateConcernReevaluationSignals(pool, options))}\n`); } finally { await pool.end(); }
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Concern signal migration failed"}\n`); process.exitCode = 1; });
