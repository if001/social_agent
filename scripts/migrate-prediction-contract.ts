import { Pool } from "pg";

import { migrateG3Output, migratePredictionOutput } from "../src/application/prediction-contract-migration.js";

type Options = { readonly agentId?: string; readonly apply: boolean };
type Row = { readonly id: string; readonly value: unknown };
type MigratedG3Task = { readonly input: unknown; readonly output: unknown };

function options(arguments_: readonly string[]): Options {
  let agentId: string | undefined; let apply = false;
  for (let index = 0; index < arguments_.length; index += 1) {
    const value = arguments_[index]; if (value === "--") continue;
    if (value === "--apply") { apply = true; continue; }
    if (value === "--agent-id") { const candidate = arguments_[index + 1]; if (candidate === undefined || candidate.trim() === "") throw new Error("--agent-id requires a value"); agentId = candidate; index += 1; continue; }
    throw new Error("Usage: pnpm prediction:migrate [--agent-id <id>] [--apply]");
  }
  return { ...(agentId === undefined ? {} : { agentId }), apply };
}

function migration<T>(rows: readonly Row[], convert: (value: unknown) => T): { readonly updates: readonly { readonly id: string; readonly value: T }[]; readonly failures: readonly string[] } {
  const updates: { id: string; value: T }[] = []; const failures: string[] = [];
  for (const row of rows) { try { updates.push({ id: row.id, value: convert(row.value) }); } catch (error) { failures.push(`${row.id}: ${error instanceof Error ? error.message : String(error)}`); } }
  return { updates, failures };
}

function migrateG3Task(value: unknown): MigratedG3Task {
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("G3 task is not an object");
  const task = value as Record<string, unknown>;
  if (typeof task.input !== "object" || task.input === null || Array.isArray(task.input)) throw new Error("G3 task input is not an object");
  const input = task.input as Record<string, unknown>;
  const prediction = migratePredictionOutput(input.prediction);
  const { prediction: _legacyPrediction, ...withoutLegacyPrediction } = input;
  return {
    input: { ...withoutLegacyPrediction, investigationReason: prediction.investigation?.reason ?? "旧G3 taskの調査理由は記録されていない", predictionEvaluations: prediction.predictionEvaluations },
    output: task.output === null ? null : migrateG3Output(task.output)
  };
}

async function main(): Promise<void> {
  const input = options(process.argv.slice(2));
  const connectionString = (process.env.POSTGRES_URL ?? "").replace("postgresql+psycopg://", "postgresql://");
  if (connectionString === "") throw new Error("POSTGRES_URL is required");
  const pool = new Pool({ connectionString });
  try {
    const filter = input.agentId ?? null;
    const predictions = await pool.query<Row>("SELECT id,output AS value FROM app.prediction_records WHERE ($1::text IS NULL OR agent_id=$1) ORDER BY created_at,id", [filter]);
    const g3Tasks = await pool.query<Row>("SELECT id,jsonb_build_object('input',input,'output',output) AS value FROM app.g3_tasks WHERE ($1::text IS NULL OR agent_id=$1) ORDER BY created_at,id", [filter]);
    const predictionMigration = migration(predictions.rows, migratePredictionOutput);
    const g3Migration = migration(g3Tasks.rows, migrateG3Task);
    const failures = [...predictionMigration.failures, ...g3Migration.failures];
    process.stdout.write(`Prediction records: ${predictionMigration.updates.length}; G3 outputs: ${g3Migration.updates.length}; invalid: ${failures.length}.\n`);
    for (const failure of failures) process.stdout.write(`${failure}\n`);
    if (!input.apply) { process.stdout.write("Dry run only. Re-run with --apply after invalid is 0.\n"); return; }
    if (failures.length > 0) throw new Error("Refusing to apply while invalid legacy prediction data remains");
    const client = await pool.connect();
    try { await client.query("BEGIN");
      for (const row of predictionMigration.updates) await client.query("UPDATE app.prediction_records SET output=$2::jsonb WHERE id=$1", [row.id, JSON.stringify(row.value)]);
      for (const row of g3Migration.updates) await client.query("UPDATE app.g3_tasks SET input=$2::jsonb,output=$3::jsonb WHERE id=$1", [row.id, JSON.stringify(row.value.input), JSON.stringify(row.value.output)]);
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    process.stdout.write("Prediction/G3 JSON migration applied.\n");
  } finally { await pool.end(); }
}

void main();
