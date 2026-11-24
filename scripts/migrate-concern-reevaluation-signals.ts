import { Pool } from "pg";

type Options = { readonly apply: boolean; readonly agentId?: string };
export type ConcernSignalMigrationResult = { readonly apply: boolean; readonly agentId: string | null; readonly concernDueSchedulesRemoved: number; readonly externalChangeSchedulesRemoved: number };

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
  if (options.apply) await pool.query("DELETE FROM app.autonomous_schedules WHERE kind IN ('concern-due','external-change') AND ($1::text IS NULL OR agent_id=$1)", [options.agentId ?? null]);
  return {
    apply: options.apply,
    agentId: options.agentId ?? null,
    concernDueSchedulesRemoved: counts.find(({ kind }) => kind === "concern-due")?.count ?? 0,
    externalChangeSchedulesRemoved: counts.find(({ kind }) => kind === "external-change")?.count ?? 0
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
