import { Pool } from "pg";

const canonical = "user-main";
const approvedShiroAliases = ["discord:shiro-main", "major", "discord:shiro", "少佐", "967027353102458880"];

type Options = { readonly agentId: string; readonly aliases: readonly string[]; readonly apply: boolean };

function parseOptions(args: readonly string[]): Options {
  let agentId: string | undefined; let apply = false; const aliases: string[] = [];
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index]; if (value === "--") continue;
    if (value === "--agent-id") { agentId = args[index + 1]; index += 1; continue; }
    if (value === "--alias") { const alias = args[index + 1]; if (alias !== undefined) aliases.push(alias); index += 1; continue; }
    if (value === "--apply") { apply = true; continue; }
    throw new Error("Usage: pnpm subject:canonicalize -- --agent-id <id> [--alias <old-subject>]... [--apply]");
  }
  if (agentId === undefined || agentId.trim() === "") throw new Error("--agent-id is required");
  const defaults = agentId === "shiro" && aliases.length === 0 ? approvedShiroAliases : aliases;
  if (defaults.length === 0) throw new Error("At least one --alias is required (shiro has approved defaults)");
  return { agentId, aliases: [...new Set(defaults)].filter((value) => value !== canonical), apply };
}

function relationshipMigration(value: unknown, aliases: readonly string[]): { readonly descriptions: readonly string[]; readonly preserved: readonly unknown[] } {
  if (!Array.isArray(value)) return { descriptions: [], preserved: [] };
  const descriptions: string[] = []; const preserved: unknown[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) { preserved.push(item); continue; }
    const record = item as Record<string, unknown>;
    if (typeof record.subjectId === "string" && aliases.includes(record.subjectId)) {
      if (typeof record.description === "string" && record.description.trim() !== "") descriptions.push(record.description.trim());
    } else preserved.push(item);
  }
  return { descriptions, preserved };
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const connectionString = (process.env.POSTGRES_URL ?? "").replace("postgresql+psycopg://", "postgresql://");
  if (connectionString === "") throw new Error("POSTGRES_URL is required");
  const pool = new Pool({ connectionString, options: "-c search_path=app,public,ext" });
  try {
    const state = (await pool.query<{ relationships: unknown }>("select relationships from app.agent_states where agent_id=$1", [options.agentId])).rows[0];
    if (state === undefined) throw new Error(`Agent state was not found: ${options.agentId}`);
    const relationship = relationshipMigration(state.relationships, [...options.aliases, canonical]);
    const relationshipDescriptions = relationship.descriptions;
    const nextRelationship = relationshipDescriptions.length === 0 ? undefined : { subjectId: canonical, description: relationshipDescriptions.join("\n") };
    const counts = await Promise.all([
      pool.query<{ count: string }>("select count(*) from app.memory_subjects ms join app.memories m on m.id=ms.memory_id where m.agent_id=$1 and ms.subject_id=any($2::text[])", [options.agentId, options.aliases]),
      pool.query<{ count: string }>("select count(*) from app.event_subjects es join app.events e on e.id=es.event_id where e.agent_id=$1 and es.subject_id=any($2::text[])", [options.agentId, options.aliases])
    ]);
    const report = { agentId: options.agentId, canonical, aliases: options.aliases, apply: options.apply, memorySubjects: Number(counts[0].rows[0]?.count ?? 0), eventSubjects: Number(counts[1].rows[0]?.count ?? 0), relationshipDescriptions: relationshipDescriptions.length, nextRelationship };
    if (!options.apply) { process.stdout.write(`${JSON.stringify(report)}\n`); return; }
    await pool.query("begin");
    try {
      const allSubjects = [...options.aliases, canonical];
      await pool.query("delete from app.memory_subjects old using app.memory_subjects kept, app.memories m where old.memory_id=m.id and kept.memory_id=old.memory_id and m.agent_id=$1 and old.subject_id=any($2::text[]) and kept.subject_id=any($3::text[]) and kept.subject_id < old.subject_id", [options.agentId, options.aliases, allSubjects]);
      await pool.query("update app.memory_subjects ms set subject_id=$3 from app.memories m where m.id=ms.memory_id and m.agent_id=$1 and ms.subject_id=any($2::text[])", [options.agentId, options.aliases, canonical]);
      await pool.query("delete from app.event_subjects old using app.event_subjects kept, app.events e where old.event_id=e.id and kept.event_id=old.event_id and e.agent_id=$1 and old.subject_id=any($2::text[]) and kept.subject_id=any($3::text[]) and kept.subject_id < old.subject_id", [options.agentId, options.aliases, allSubjects]);
      await pool.query("update app.event_subjects es set subject_id=$3 from app.events e where e.id=es.event_id and e.agent_id=$1 and es.subject_id=any($2::text[])", [options.agentId, options.aliases, canonical]);
      const relationships = nextRelationship === undefined ? relationship.preserved : [...relationship.preserved, nextRelationship];
      await pool.query("update app.agent_states set relationships=$2::jsonb, version=version+1, updated_at=now() where agent_id=$1", [options.agentId, JSON.stringify(relationships)]);
      await pool.query("commit");
    } catch (error) { await pool.query("rollback"); throw error; }
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally { await pool.end(); }
}

void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Canonical subject migration failed"}\n`); process.exitCode = 1; });
