import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = process.cwd();
const metaDirectory = resolve(root, "drizzle/meta");
const journalPath = resolve(metaDirectory, "_journal.json");
const failedMigrationIndex = 36;

type Snapshot = { readonly tables: Record<string, Record<string, unknown>> };
type Journal = { readonly entries: readonly { readonly tag: string; readonly idx: number }[] };

function usage(): never { throw new Error("Usage: pnpm db:rebaseline:app-schema -- --apply"); }

function appSnapshot(snapshot: Snapshot): Snapshot {
  const tables = Object.fromEntries(Object.entries(snapshot.tables).map(([key, table]) => {
    const name = typeof table.name === "string" ? table.name : undefined;
    if (name === undefined) throw new Error(`Snapshot table '${key}' has no name`);
    const foreignKeys = typeof table.foreignKeys === "object" && table.foreignKeys !== null
      ? Object.fromEntries(Object.entries(table.foreignKeys as Record<string, Record<string, unknown>>).map(([foreignKeyName, foreignKey]) => [foreignKeyName, { ...foreignKey, schemaTo: "app" }]))
      : table.foreignKeys;
    return [`app.${name}`, { ...table, schema: "app", ...(foreignKeys === undefined ? {} : { foreignKeys }) }];
  }));
  return { ...snapshot, tables };
}

async function main(): Promise<void> {
  if (process.argv.slice(2).filter((value) => value !== "--").join(" ") !== "--apply") usage();
  const journal = JSON.parse(await readFile(journalPath, "utf8")) as Journal;
  const last = journal.entries.at(-1);
  if (last?.idx !== failedMigrationIndex || !last.tag.startsWith("0036_")) throw new Error(`Expected an unapplied final 0036 migration, found '${last?.tag ?? "none"}'`);

  const failedSql = resolve(root, `drizzle/${last.tag}.sql`);
  const failedSnapshot = resolve(metaDirectory, `${String(failedMigrationIndex).padStart(4, "0")}_snapshot.json`);
  const sql = await readFile(failedSql, "utf8");
  if (!sql.includes('CREATE TABLE "app"."reflection_resolutions"') && !sql.includes('CREATE TABLE "reflection_resolutions"')) throw new Error(`${last.tag} is not the expected failed reflection migration`);

  const files = (await Promise.all(Array.from({ length: 36 }, async (_, index) => {
    const name = `${String(index).padStart(4, "0")}_snapshot.json`;
    const path = resolve(metaDirectory, name);
    try { return { path, snapshot: JSON.parse(await readFile(path, "utf8")) as Snapshot }; } catch { return undefined; }
  }))).filter((value): value is { path: string; snapshot: Snapshot } => value !== undefined);
  if (files.length === 0) throw new Error("No pre-0036 Drizzle snapshots found");

  for (const file of files) await writeFile(file.path, `${JSON.stringify(appSnapshot(file.snapshot), null, 2)}\n`);
  await writeFile(journalPath, `${JSON.stringify({ ...journal, entries: journal.entries.slice(0, -1) }, null, 2)}\n`);
  await rm(failedSql); await rm(failedSnapshot);
  process.stdout.write("Rebased Drizzle snapshots and FK schema metadata to app, then removed unapplied 0036. Run: pnpm db:generate\n");
}

void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Drizzle baseline failed"}\n`); process.exitCode = 1; });
