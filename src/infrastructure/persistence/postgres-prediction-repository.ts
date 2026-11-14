import type { Pool, QueryResultRow } from "pg";

import type { PredictionRecord, PredictionRepository } from "../../application/prediction.js";
import { normalizeLegacyPredictionOutput } from "../../application/legacy-prediction-normalization.js";
import { PredictionContextSchema, PredictionOutputSchema, type PredictionContext } from "../../domain/contracts.js";

type Row = QueryResultRow & {
  id: string;
  agent_id: string;
  source_event_id: string;
  source_run_id: string;
  output: unknown;
  created_at: Date;
};

/**
 * `remember` and `observationCandidates` were retired from the persisted
 * Prediction contract.  Existing rows can still contain them, so remove only
 * those known obsolete root fields before strict validation.  Any other shape
 * error remains visible instead of being silently accepted.
 */
function parsedOutput(value: unknown) {
  return normalizeLegacyPredictionOutput(value);
}

export { normalizeLegacyPredictionOutput } from "../../application/legacy-prediction-normalization.js";

const toRecord = (row: Row): PredictionRecord => ({
  id: row.id,
  agentId: row.agent_id,
  sourceEventId: row.source_event_id,
  sourceRunId: row.source_run_id,
  output: parsedOutput(row.output),
  createdAt: row.created_at.toISOString()
});

export class PostgresPredictionRepository implements PredictionRepository {
  constructor(private readonly pool: Pool) {}

  async save(record: PredictionRecord): Promise<void> {
    const output = PredictionOutputSchema.parse(record.output);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const source = await client.query<{ agent_id: string; event_id: string }>("SELECT agent_id,event_id FROM agent_runs WHERE id=$1", [record.sourceRunId]);
      const parent = source.rows[0];
      if (parent === undefined || parent.agent_id !== record.agentId || parent.event_id !== record.sourceEventId) throw new Error("Prediction source Run does not match its Agent and Event");
      // Keep compatibility columns populated until #045 validates existing data
      // and switches every reader/writer in one deployment.
      await client.query("INSERT INTO prediction_records(id,agent_id,source_event_id,source_run_id,output,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [record.id, record.agentId, record.sourceEventId, record.sourceRunId, JSON.stringify(output), record.createdAt]);
      for (const [index, evaluation] of output.predictionEvaluations.entries()) {
        await client.query(
          'INSERT INTO prediction_evaluations(id,prediction_id,agent_id,"group",candidate_index,match,surprise,difference,interpretation,uncertainty,attribution,observed,error_direction,effect,effect_evidence,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)',
          [`${record.id}:${String(index)}`, record.id, record.agentId, evaluation.group, evaluation.candidateIndex, evaluation.match, evaluation.surprise, evaluation.difference, evaluation.interpretation, evaluation.uncertainty, evaluation.attribution ?? null, evaluation.observed, evaluation.errorDirection, evaluation.effect, evaluation.effectEvidence ?? null, record.createdAt]
        );
      }
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async latest(agentId: string): Promise<PredictionRecord | undefined> {
    const result = await this.pool.query<Row>("SELECT p.id,COALESCE(e.agent_id,p.agent_id) AS agent_id,COALESCE(e.id,p.source_event_id) AS source_event_id,p.source_run_id,p.output,p.created_at FROM prediction_records p LEFT JOIN agent_runs r ON r.id=p.source_run_id LEFT JOIN events e ON e.id=r.event_id WHERE COALESCE(e.agent_id,p.agent_id)=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT 1", [agentId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toRecord(row);
  }

  async context(agentId: string): Promise<PredictionContext | undefined> {
    const result = await this.pool.query<Row>("SELECT p.id,COALESCE(e.agent_id,p.agent_id) AS agent_id,COALESCE(e.id,p.source_event_id) AS source_event_id,p.source_run_id,p.output,p.created_at FROM prediction_records p LEFT JOIN agent_runs r ON r.id=p.source_run_id LEFT JOIN events e ON e.id=r.event_id WHERE COALESCE(e.agent_id,p.agent_id)=$1 ORDER BY p.created_at DESC,p.id DESC LIMIT 3", [agentId]);
    if (result.rows.length === 0) return undefined;
    const latestRow = result.rows[0];
    if (latestRow === undefined) return undefined;
    const latest = toRecord(latestRow);
    const evaluatedRow = result.rows[1];
    const effect = latest.output.predictionEvaluations[0];
    return PredictionContextSchema.parse({
      agentId,
      previousPrediction: { id: latest.id, createdAt: latest.createdAt, output: latest.output },
      g3MemoryIntents: [],
      ...(effect === undefined ? {} : { recentExperienceEffect: { eventId: evaluatedRow?.source_event_id ?? latest.sourceEventId, effect: effect.effect, ...(effect.effectEvidence === undefined ? {} : { evidence: effect.effectEvidence }) } }),
      memoryCandidates: []
    });
  }
}
