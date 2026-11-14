import { createHash } from "node:crypto";
import { Pool } from "pg";

type Options = { readonly apply: boolean; readonly agentId?: string };
export type NormalizedEventMigrationResult = { readonly apply: boolean; readonly agentId: string | null; readonly experiences: number; readonly subjects: number; readonly inconsistencies: number; readonly activeWorkItems: number };

export function parseNormalizedEventMigrationOptions(args: readonly string[]): Options {
  let apply = false; let agentId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") continue;
    if (value === "--apply") { apply = true; continue; }
    if (value === "--agent-id") { agentId = args[index + 1]; index += 1; continue; }
    throw new Error("Usage: pnpm event:storage:migrate [--agent-id <id>] [--apply]");
  }
  if (agentId !== undefined && agentId.trim() === "") throw new Error("--agent-id must not be empty");
  return { apply, ...(agentId === undefined ? {} : { agentId }) };
}

const hash = (summary: string, facts: unknown) => createHash("sha256").update(`${summary}\n${Array.isArray(facts) ? facts.filter((value): value is string => typeof value === "string").join("\n") : ""}`).digest("hex");

export async function migrateNormalizedEventStorage(pool: Pool, options: Options): Promise<NormalizedEventMigrationResult> {
    const experiences = (await pool.query<{ event_id: string; summary: string; facts: unknown; subjects: unknown }>(`SELECT x.event_id,x.summary,x.facts,x.subjects FROM app.event_experiences x JOIN app.events e ON e.id=x.event_id WHERE ($1::text IS NULL OR e.agent_id=$1) ORDER BY x.event_id`, [options.agentId ?? null])).rows;
    const inconsistencies = Number.parseInt((await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM app.experience_integrations i LEFT JOIN app.agent_runs r ON r.id=i.source_run_id LEFT JOIN app.events e ON e.id=r.event_id WHERE r.id IS NULL OR e.id IS NULL OR (i.agent_id IS NOT NULL AND i.agent_id<>e.agent_id) OR (i.source_event_id IS NOT NULL AND i.source_event_id<>e.id)`)).rows[0]?.count ?? "0", 10);
    if (inconsistencies > 0) throw new Error(`Event storage migration found ${String(inconsistencies)} inconsistent integration references`);
    const activeWorkItems = Number.parseInt((await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM app.experience_integrations i JOIN app.agent_runs r ON r.id=i.source_run_id JOIN app.events e ON e.id=r.event_id WHERE i.status IN ('pending','processing') AND ($1::text IS NULL OR e.agent_id=$1)`, [options.agentId ?? null])).rows[0]?.count ?? "0", 10);
    if (options.apply && activeWorkItems > 0) throw new Error(`Event storage migration found ${String(activeWorkItems)} active integration work items`);
    let subjects = 0;
    if (options.apply) {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        for (const experience of experiences) {
          await client.query(`INSERT INTO app.event_projections(event_id,content_hash,embedding_status)
            VALUES ($1,$2,'pending') ON CONFLICT (event_id) DO UPDATE SET
            embedding=CASE WHEN app.event_projections.content_hash IS DISTINCT FROM EXCLUDED.content_hash THEN NULL ELSE app.event_projections.embedding END,
            embedding_model=CASE WHEN app.event_projections.content_hash IS DISTINCT FROM EXCLUDED.content_hash THEN NULL ELSE app.event_projections.embedding_model END,
            embedding_dimension=CASE WHEN app.event_projections.content_hash IS DISTINCT FROM EXCLUDED.content_hash THEN NULL ELSE app.event_projections.embedding_dimension END,
            embedding_status=CASE WHEN app.event_projections.content_hash IS DISTINCT FROM EXCLUDED.content_hash THEN 'pending' ELSE app.event_projections.embedding_status END,
            embedding_error=CASE WHEN app.event_projections.content_hash IS DISTINCT FROM EXCLUDED.content_hash THEN NULL ELSE app.event_projections.embedding_error END,
            content_hash=EXCLUDED.content_hash,updated_at=now()`, [experience.event_id, hash(experience.summary, experience.facts)]);
          for (const subjectId of Array.isArray(experience.subjects) ? experience.subjects.filter((value): value is string => typeof value === "string") : []) {
            subjects += (await client.query("INSERT INTO app.event_subjects(event_id,subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [experience.event_id, subjectId])).rowCount ?? 0;
          }
        }
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    } else {
      subjects = experiences.reduce((count, experience) => count + (Array.isArray(experience.subjects) ? experience.subjects.filter((value) => typeof value === "string").length : 0), 0);
    }
    return { apply: options.apply, agentId: options.agentId ?? null, experiences: experiences.length, subjects, inconsistencies, activeWorkItems };
}

async function main(): Promise<void> {
  const options = parseNormalizedEventMigrationOptions(process.argv.slice(2));
  const url = (process.env.ADMIN_POSTGRES_URL ?? "").replace("postgresql+psycopg://", "postgresql://");
  if (url === "") throw new Error("ADMIN_POSTGRES_URL is required");
  const pool = new Pool({ connectionString: url });
  try {
    process.stdout.write(`${JSON.stringify(await migrateNormalizedEventStorage(pool, options))}\n`);
  } finally { await pool.end(); }
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Event storage migration failed"}\n`); process.exitCode = 1; });
