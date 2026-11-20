import { and, desc, eq, sql } from "drizzle-orm";

import type { PredictionRecord, PredictionRepository } from "../../application/prediction.js";
import { normalizeLegacyPredictionOutput } from "../../application/legacy-prediction-normalization.js";
import { PredictionContextSchema, PredictionOutputSchema, type PredictionContext } from "../../domain/contracts.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { agentRuns, events, eventSubjects, predictionEvaluations, predictionRecords } from "./schema.js";

type Row = {
  id: string;
  agentId: string;
  sourceEventId: string;
  sourceRunId: string;
  output: unknown;
  createdAt: Date;
};

function parsedOutput(value: unknown) {
  return normalizeLegacyPredictionOutput(value);
}

export { normalizeLegacyPredictionOutput } from "../../application/legacy-prediction-normalization.js";

const toRecord = (row: Row): PredictionRecord => ({
  id: row.id,
  agentId: row.agentId,
  sourceEventId: row.sourceEventId,
  sourceRunId: row.sourceRunId,
  output: parsedOutput(row.output),
  createdAt: row.createdAt.toISOString()
});

export class PostgresPredictionRepository implements PredictionRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  async save(record: PredictionRecord): Promise<void> {
    const output = PredictionOutputSchema.parse(record.output);
    await this.database.transaction(async (tx) => {
      const parent = (await tx.select({
        agentId: agentRuns.agentId,
        eventId: agentRuns.eventId
      }).from(agentRuns).where(eq(agentRuns.id, record.sourceRunId)).limit(1))[0];
      if (parent === undefined || parent.agentId !== record.agentId || parent.eventId !== record.sourceEventId) {
        throw new Error("Prediction source Run does not match its Agent and Event");
      }
      await tx.insert(predictionRecords).values({
        id: record.id,
        agentId: record.agentId,
        sourceEventId: record.sourceEventId,
        sourceRunId: record.sourceRunId,
        output,
        createdAt: new Date(record.createdAt)
      });
      if (output.predictionEvaluations.length > 0) {
        await tx.insert(predictionEvaluations).values(output.predictionEvaluations.map((evaluation, index) => ({
          id: `${record.id}:${String(index)}`,
          predictionId: record.id,
          agentId: record.agentId,
          group: evaluation.group,
          candidateIndex: evaluation.candidateIndex,
          match: evaluation.match,
          surprise: evaluation.surprise,
          difference: evaluation.difference,
          interpretation: evaluation.interpretation,
          uncertainty: evaluation.uncertainty,
          attribution: evaluation.attribution ?? null,
          observed: evaluation.observed,
          errorDirection: evaluation.errorDirection,
          effect: evaluation.effect,
          effectEvidence: evaluation.effectEvidence ?? null,
          createdAt: new Date(record.createdAt)
        })));
      }
    });
  }

  private async rows(agentId: string, limit: number, subjectId?: string): Promise<readonly Row[]> {
    const resolvedAgentId = sql<string>`coalesce(${events.agentId}, ${predictionRecords.agentId})`;
    return this.database.db.select({
      id: predictionRecords.id,
      agentId: resolvedAgentId,
      sourceEventId: sql<string>`coalesce(${events.id}, ${predictionRecords.sourceEventId})`,
      sourceRunId: predictionRecords.sourceRunId,
      output: predictionRecords.output,
      createdAt: predictionRecords.createdAt
    }).from(predictionRecords)
      .leftJoin(agentRuns, eq(agentRuns.id, predictionRecords.sourceRunId))
      .leftJoin(events, eq(events.id, agentRuns.eventId))
      .leftJoin(eventSubjects, eq(eventSubjects.eventId, predictionRecords.sourceEventId))
      .where(subjectId === undefined ? eq(resolvedAgentId, agentId) : and(eq(resolvedAgentId, agentId), eq(eventSubjects.subjectId, subjectId)))
      .orderBy(desc(predictionRecords.createdAt), desc(predictionRecords.id))
      .limit(limit);
  }

  async latest(agentId: string, subjectId?: string): Promise<PredictionRecord | undefined> {
    const row = (await this.rows(agentId, 1, subjectId))[0];
    return row === undefined ? undefined : toRecord(row);
  }

  async context(agentId: string): Promise<PredictionContext | undefined> {
    const rows = await this.rows(agentId, 3);
    const latestRow = rows[0];
    if (latestRow === undefined) return undefined;
    const latest = toRecord(latestRow);
    const evaluatedRow = rows[1];
    const effect = latest.output.predictionEvaluations[0];
    return PredictionContextSchema.parse({
      agentId,
      previousPrediction: { id: latest.id, createdAt: latest.createdAt, output: latest.output },
      g3MemoryIntents: [],
      ...(effect === undefined ? {} : { recentExperienceEffect: {
        eventId: evaluatedRow?.sourceEventId ?? latest.sourceEventId,
        effect: effect.effect,
        ...(effect.effectEvidence === undefined ? {} : { evidence: effect.effectEvidence })
      } }),
      memoryCandidates: []
    });
  }
}
