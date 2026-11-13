import type { PredictionOutput } from "../domain/contracts.js";
import { PredictionOutputSchema } from "../domain/contracts.js";

export function normalizeLegacyPredictionOutput(value: unknown): PredictionOutput {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return PredictionOutputSchema.parse(value);
  const { remember: _remember, observationCandidates: _observationCandidates, ...current } = value as Record<string, unknown>;
  return PredictionOutputSchema.parse(current);
}

export interface PredictionNormalizationStore {
  query<Result extends { readonly rows: readonly { readonly id: string; readonly output: unknown }[] }>(query: string, values?: readonly unknown[]): Promise<Result>;
}

export async function normalizeLegacyPredictionRecords(store: PredictionNormalizationStore, agentId?: string): Promise<number> {
  const rows = await store.query<{ readonly rows: readonly { readonly id: string; readonly output: unknown }[] }>("SELECT id,output FROM prediction_records WHERE ($1::text IS NULL OR agent_id=$1) ORDER BY created_at,id", [agentId ?? null]);
  let updated = 0;
  for (const row of rows.rows) {
    if (typeof row.output !== "object" || row.output === null || Array.isArray(row.output) || (!("remember" in row.output) && !("observationCandidates" in row.output))) continue;
    await store.query("UPDATE prediction_records SET output=$2 WHERE id=$1", [row.id, JSON.stringify(normalizeLegacyPredictionOutput(row.output))]);
    updated += 1;
  }
  return updated;
}
