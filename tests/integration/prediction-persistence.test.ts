import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PredictionRecord } from "../../src/application/prediction.js";
import { PostgresPredictionRepository } from "../../src/infrastructure/persistence/postgres-prediction-repository.js";
import { createIntegrationDatabase, integrationDatabaseConfigured } from "../support/integration-database.js";

const describeDatabase = integrationDatabaseConfigured() ? describe : describe.skip;

const record = (id: string, sourceEventId = "event-1", createdAt = "2026-10-31T00:00:00.000Z"): PredictionRecord => ({
  id, agentId: "a", sourceEventId, sourceRunId: "run-1",
  output: {
    predictions: {
      g1: { candidates: [{ candidateIndex: 0, feature: "語彙", content: "技術の話を続ける", expectation: "medium", contextSummary: "技術の話題", rationale: "直前の話題" }] },
      g2: { candidates: [{ candidateIndex: 0, speechAct: "質問", content: "技術について質問する", expectation: "medium", contextSummary: "技術の話題", rationale: "関心が続く" }] }
    },
    predictionEvaluations: [],
    g3: { needsG3: false, targetLayers: [], priority: "medium" }
  },
  createdAt
});

describeDatabase("Prediction persistence", () => {
  let database: ReturnType<typeof createIntegrationDatabase>;
  let pool: Pool;
  beforeAll(async () => {
    database = createIntegrationDatabase(); pool = database.pool;
    await database.prepare();
    await pool.query("INSERT INTO agent_families(id,name,shared_disposition,base_instruction) VALUES ('family','Family','Curious','Help')");
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ('a','family','Agent A','Calm'),('b','family','Agent B','Bold')");
    await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,concerns,relationships,mood) VALUES ('a','Careful','Growing','[]','[]','[]','Calm'),('b','Bold','Growing','[]','[]','[]','Calm')");
  });
  afterAll(async () => {
    await database.close();
  });

  it("FR-48, FR-62, NFR-14: stores and loads prediction history per agent", async () => {
    const repository = new PostgresPredictionRepository(pool);
    await repository.save(record("prediction-1", "event-1", "2026-10-31T00:00:00.000Z"));
    await repository.save({ ...record("prediction-2", "event-2", "2026-10-31T01:00:00.000Z"), output: { ...record("prediction-2").output, predictionEvaluations: [{ group: "g2", candidateIndex: 0, match: "primary", surprise: "none", difference: "ずれなし", interpretation: "継続", uncertainty: "低い", observed: "継続", errorDirection: "matched", effect: "unchanged" }] } });
    const latest = await repository.latest("a");
    expect(latest?.id).toBe("prediction-2");
    const context = await repository.context("a");
    expect(context?.previousPrediction?.output.predictions.g1.candidates[0]?.content).toBe("技術の話を続ける");
    expect(context?.recentExperienceEffect?.eventId).toBe("event-1");
    expect(context?.agentId).toBe("a");
    expect(await repository.latest("b")).toBeUndefined();
  });

  it("normalizes obsolete stored fields from a real database record", async () => {
    const legacy = {
      ...record("prediction-legacy", "event-legacy", "2026-11-01T00:00:00.000Z"),
      output: { ...record("prediction-legacy").output, remember: [{ content: "obsolete" }], observationCandidates: [{ summary: "obsolete" }] }
    };
    await pool.query("INSERT INTO prediction_records(id,agent_id,source_event_id,source_run_id,output,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [legacy.id, legacy.agentId, legacy.sourceEventId, legacy.sourceRunId, legacy.output, legacy.createdAt]);
    const repository = new PostgresPredictionRepository(pool);
    const loaded = await repository.latest("a");
    const context = await repository.context("a");
    expect(loaded?.id).toBe("prediction-legacy");
    expect(loaded?.output).not.toHaveProperty("remember");
    expect(loaded?.output).not.toHaveProperty("observationCandidates");
    expect(context?.previousPrediction?.id).toBe("prediction-legacy");
  });
});
