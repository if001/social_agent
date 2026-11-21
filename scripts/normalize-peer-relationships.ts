import { resolve } from "node:path";
import { Pool } from "pg";
import { eq, sql } from "drizzle-orm";

import { loadInitialSelfFile } from "../src/config/initial-self.js";
import { RelationshipSchema } from "../src/domain/contracts.js";
import { createRuntimeDatabase } from "../src/infrastructure/persistence/runtime-database.js";
import { agentStates } from "../src/infrastructure/persistence/schema.js";

type Options = { readonly agentId: string; readonly apply: boolean };
function options(args: readonly string[]): Options { const agentId = args.at(args.indexOf("--agent-id") + 1); if (args.includes("--agent-id") && agentId !== undefined) return { agentId, apply: args.includes("--apply") }; throw new Error("Usage: pnpm relationship:peer:normalize -- --agent-id <id> [--apply]"); }
const canonical = (subjectId: string): boolean => subjectId === "user-main" || /^agent:[a-z0-9_-]+$/u.test(subjectId);

async function main(): Promise<void> {
  const input = options(process.argv.slice(2)); const connectionString = process.env.POSTGRES_URL;
  if (connectionString === undefined || connectionString === "") throw new Error("POSTGRES_URL is required");
  const pool = new Pool({ connectionString }); const database = createRuntimeDatabase(pool);
  try {
    const configured = await loadInitialSelfFile(resolve(process.cwd(), "config", "initial-self", `${input.agentId}.yaml`));
    const state = await database.db.select({ relationships: agentStates.relationships }).from(agentStates).where(eq(agentStates.agentId, input.agentId)).limit(1);
    if (state[0] === undefined) throw new Error(`Agent state was not found: ${input.agentId}`);
    const current = Array.isArray(state[0].relationships) ? state[0].relationships.flatMap((value) => { const parsed = RelationshipSchema.safeParse(value); return parsed.success && canonical(parsed.data.subjectId) ? [parsed.data] : []; }) : [];
    const seeds = configured.initialState.relationships.filter((value) => value.subjectId.startsWith("agent:"));
    const next = [...new Map([...current, ...seeds].map((value) => [value.subjectId, value])).values()];
    const report = { agentId: input.agentId, apply: input.apply, removed: (Array.isArray(state[0].relationships) ? state[0].relationships.length : 0) - current.length, addedPeerRelationships: seeds.filter((value) => !current.some((currentValue) => currentValue.subjectId === value.subjectId)).map(({ subjectId }) => subjectId), relationshipCount: next.length };
    if (input.apply) await database.db.update(agentStates).set({ relationships: next, version: sql`${agentStates.version}+1`, updatedAt: new Date() }).where(eq(agentStates.agentId, input.agentId));
    process.stdout.write(`${JSON.stringify(report)}\n`);
  } finally { await pool.end(); }
}
void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Peer relationship normalization failed"}\n`); process.exitCode = 1; });
