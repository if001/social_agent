import type { Pool, QueryResultRow } from "pg";

import type { PredictionRecord, PredictionRepository } from "../../application/prediction.js";
import { PredictionContextSchema, PredictionOutputSchema, type PredictionContext } from "../../domain/contracts.js";

type Row = QueryResultRow & {
  id: string;
  agent_id: string;
  source_event_id: string;
  source_run_id: string;
  output: unknown;
  created_at: Date;
};

const toRecord = (row: Row): PredictionRecord => ({
  id: row.id,
  agentId: row.agent_id,
  sourceEventId: row.source_event_id,
  sourceRunId: row.source_run_id,
  output: PredictionOutputSchema.parse(row.output),
  createdAt: row.created_at.toISOString()
});

export class PostgresPredictionRepository implements PredictionRepository {
  constructor(private readonly pool: Pool) {}

  async save(record: PredictionRecord): Promise<void> {
    const output = PredictionOutputSchema.parse(record.output);
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
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
    const result = await this.pool.query<Row>("SELECT id,agent_id,source_event_id,source_run_id,output,created_at FROM prediction_records WHERE agent_id=$1 ORDER BY created_at DESC,id DESC LIMIT 1", [agentId]);
    const row = result.rows[0];
    return row === undefined ? undefined : toRecord(row);
  }

  async context(agentId: string): Promise<PredictionContext | undefined> {
    const result = await this.pool.query<Row>("SELECT id,agent_id,source_event_id,source_run_id,output,created_at FROM prediction_records WHERE agent_id=$1 ORDER BY created_at DESC,id DESC LIMIT 3", [agentId]);
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
