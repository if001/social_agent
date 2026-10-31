import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parse } from "dotenv";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PredictionRecord } from "../../src/application/prediction.js";
import { PostgresPredictionRepository } from "../../src/infrastructure/persistence/postgres-prediction-repository.js";
import { migrate } from "../../src/infrastructure/persistence/postgres.js";

const sample = parse(await readFile(new URL("../../.env.sample", import.meta.url)));
const databaseUrl = (process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL ?? sample.POSTGRES_URL)?.replace("postgresql+psycopg://", "postgresql://");
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

const record = (id: string, sourceEventId = "event-1", createdAt = "2026-10-31T00:00:00.000Z"): PredictionRecord => ({
  id, agentId: "a", sourceEventId, sourceRunId: "run-1",
  output: {
    predictions: {
      g1: { candidates: [{ candidateIndex: 0, feature: "語彙", content: "技術の話を続ける", expectation: "medium", contextSummary: "技術の話題", rationale: "直前の話題" }] },
      g2: { candidates: [{ candidateIndex: 0, speechAct: "質問", content: "技術について質問する", expectation: "medium", contextSummary: "技術の話題", rationale: "関心が続く" }] }
    },
    predictionEvaluations: [],
    remember: [],
    observationCandidates: [],
    g3: { needsG3: false, targetLayers: [], priority: "medium" }
  },
  createdAt
});

describeDatabase("Prediction persistence", () => {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const control = new Pool({ connectionString: databaseUrl, max: 2 });
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public,ext`, max: 4 });
  beforeAll(async () => {
    await control.query(`CREATE SCHEMA ${schema}`);
    await migrate(pool);
    await pool.query("INSERT INTO agent_families(id,name,shared_disposition,base_instruction) VALUES ('family','Family','Curious','Help')");
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ('a','family','Agent A','Calm'),('b','family','Agent B','Bold')");
    await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,concerns,relationships,mood) VALUES ('a','Careful','Growing','[]','[]','[]','Calm'),('b','Bold','Growing','[]','[]','[]','Calm')");
  });
  afterAll(async () => {
    await pool.end();
    await control.query(`DROP SCHEMA ${schema} CASCADE`);
    await control.end();
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
});
