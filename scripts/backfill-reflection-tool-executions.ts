import { createHash } from "node:crypto";
import { Pool } from "pg";
import { ToolExecutionRecordSchema, type ToolExecutionRecord } from "../src/domain/contracts.js";

type Options = { readonly apply: boolean; readonly agentId?: string };
export type ReflectionToolBackfillResult = { readonly apply: boolean; readonly agentId: string | null; readonly sourceScopes: number; readonly validExecutions: number; readonly invalidExecutions: number; readonly inserted: number; readonly activeScopes: number };

export function parseReflectionToolBackfillOptions(args: readonly string[]): Options {
  let apply = false; let agentId: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const value = args[index];
    if (value === "--") continue;
    if (value === "--apply") { apply = true; continue; }
    if (value === "--agent-id") { agentId = args[index + 1]; index += 1; continue; }
    throw new Error("Usage: pnpm reflection:tools:backfill [--agent-id <id>] [--apply]");
  }
  if (agentId !== undefined && agentId.trim() === "") throw new Error("--agent-id must not be empty");
  return { apply, ...(agentId === undefined ? {} : { agentId }) };
}

type LegacyScope = { readonly reflection_id: string; readonly target: string; readonly batch_index: number | null; readonly tool_executions: unknown };
const stableId = (scope: LegacyScope, index: number) => `reflection-tool-backfill:${createHash("sha256").update(`${scope.reflection_id}\n${scope.target}\n${scope.batch_index === null ? "target" : String(scope.batch_index)}\n${String(index)}`).digest("hex")}`;

function executions(value: unknown): readonly ToolExecutionRecord[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((item) => { const parsed = ToolExecutionRecordSchema.safeParse(item); return parsed.success ? [parsed.data] : []; });
}

export async function backfillReflectionToolExecutions(pool: Pool, options: Options): Promise<ReflectionToolBackfillResult> {
  const scopes = (await pool.query<LegacyScope>(`SELECT a.reflection_id,a.target,NULL::integer AS batch_index,a.tool_executions
    FROM app.reflection_attempts a JOIN app.reflection_runs r ON r.id=a.reflection_id
    WHERE jsonb_array_length(a.tool_executions)>0 AND ($1::text IS NULL OR r.agent_id=$1)
      AND (a.target<>'memory' OR NOT EXISTS (SELECT 1 FROM app.reflection_memory_batches b WHERE b.reflection_id=a.reflection_id))
      AND NOT EXISTS (SELECT 1 FROM app.reflection_tool_executions t WHERE t.reflection_id=a.reflection_id AND t.target=a.target AND t.batch_index IS NULL)
    UNION ALL
    SELECT b.reflection_id,'memory'::text AS target,b.batch_index,b.tool_executions
    FROM app.reflection_memory_batches b JOIN app.reflection_runs r ON r.id=b.reflection_id
    WHERE jsonb_array_length(b.tool_executions)>0 AND ($1::text IS NULL OR r.agent_id=$1)
      AND NOT EXISTS (SELECT 1 FROM app.reflection_tool_executions t WHERE t.reflection_id=b.reflection_id AND t.target='memory' AND t.batch_index=b.batch_index)
    ORDER BY reflection_id,target,batch_index NULLS FIRST`, [options.agentId ?? null])).rows;
  const activeScopes = Number.parseInt((await pool.query<{ count: string }>(`SELECT count(*)::text AS count FROM app.reflection_runs r
    WHERE r.status<>'completed' AND ($1::text IS NULL OR r.agent_id=$1)`, [options.agentId ?? null])).rows[0]?.count ?? "0", 10);
  if (options.apply && activeScopes > 0) throw new Error(`Reflection Tool backfill found ${String(activeScopes)} unfinished Reflection Sessions`);
  const validExecutions = scopes.reduce((count, scope) => count + executions(scope.tool_executions).length, 0);
  const legacyExecutions = scopes.reduce((count, scope) => count + (Array.isArray(scope.tool_executions) ? scope.tool_executions.length : 0), 0);
  const invalidExecutions = legacyExecutions - validExecutions;
  if (options.apply && invalidExecutions > 0) throw new Error(`Reflection Tool backfill found ${String(invalidExecutions)} invalid legacy executions`);
  let inserted = 0;
  if (options.apply) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const scope of scopes) {
        for (const [executionIndex, execution] of executions(scope.tool_executions).entries()) {
          inserted += (await client.query(`INSERT INTO app.reflection_tool_executions(id,reflection_id,target,batch_index,anchor_memory_id,execution_index,tool_call_id,tool,input,result,error,started_at,finished_at)
            VALUES ($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,$11,$12) ON CONFLICT (id) DO NOTHING`, [stableId(scope, executionIndex), scope.reflection_id, scope.target, scope.batch_index, executionIndex, execution.callId, execution.name, execution.input, execution.ok ? execution.result : null, execution.ok ? null : execution.error, execution.startedAt, execution.finishedAt])).rowCount ?? 0;
        }
        if (scope.batch_index === null) await client.query("UPDATE app.reflection_attempts SET tool_executions=NULL WHERE reflection_id=$1 AND target=$2", [scope.reflection_id, scope.target]);
        else await client.query("UPDATE app.reflection_memory_batches SET tool_executions=NULL WHERE reflection_id=$1 AND batch_index=$2", [scope.reflection_id, scope.batch_index]);
      }
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  return { apply: options.apply, agentId: options.agentId ?? null, sourceScopes: scopes.length, validExecutions, invalidExecutions, inserted, activeScopes };
}

async function main(): Promise<void> {
  const options = parseReflectionToolBackfillOptions(process.argv.slice(2));
  const url = (process.env.ADMIN_POSTGRES_URL ?? "").replace("postgresql+psycopg://", "postgresql://");
  if (url === "") throw new Error("ADMIN_POSTGRES_URL is required");
  const pool = new Pool({ connectionString: url });
  try { process.stdout.write(`${JSON.stringify(await backfillReflectionToolExecutions(pool, options))}\n`); } finally { await pool.end(); }
}

if (process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`) void main().catch((error: unknown) => { process.stderr.write(`${error instanceof Error ? error.message : "Reflection Tool backfill failed"}\n`); process.exitCode = 1; });
