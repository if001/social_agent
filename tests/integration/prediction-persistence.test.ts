import type { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { PredictionRecord } from "../../src/application/prediction.js";
import type { G3Task } from "../../src/application/g3.js";
import { PostgresG3TaskRepository } from "../../src/infrastructure/persistence/postgres-g3-task-repository.js";
import { PostgresPredictionRepository } from "../../src/infrastructure/persistence/postgres-prediction-repository.js";
import { createRuntimeDatabase } from "../../src/infrastructure/persistence/runtime-database.js";
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
    await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,relationships,mood) VALUES ('a','Careful','Growing','[]','[]','Calm'),('b','Bold','Growing','[]','[]','Calm')");
    for (const [eventId, runId, occurredAt] of [["event-1", "run-1", "2026-10-31T00:00:00.000Z"], ["event-2", "run-2", "2026-10-31T01:00:00.000Z"], ["event-legacy", "run-legacy", "2026-11-01T00:00:00.000Z"]] as const) {
      await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ($1,'a','user-message','{}','test','completed',$2)", [eventId, occurredAt]);
      await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,started_at,finished_at) VALUES ($1,'a',$2,0,$3,$3)", [runId, eventId, occurredAt]);
    }
  });
  afterAll(async () => {
    await database.close();
  });

  it("FR-48, FR-62, NFR-14: stores and loads prediction history per agent", async () => {
    const repository = new PostgresPredictionRepository(createRuntimeDatabase(pool));
    await repository.save(record("prediction-1", "event-1", "2026-10-31T00:00:00.000Z"));
    await repository.save({ ...record("prediction-2", "event-2", "2026-10-31T01:00:00.000Z"), sourceRunId: "run-2", output: { ...record("prediction-2").output, predictionEvaluations: [{ group: "g2", candidateIndex: 0, match: "primary", surprise: "none", difference: "ずれなし", interpretation: "継続", uncertainty: "低い", observed: "継続", errorDirection: "matched", effect: "unchanged" }] } });
    const latest = await repository.latest("a");
    expect(latest?.id).toBe("prediction-2");
    const context = await repository.context("a");
    expect(context?.previousPrediction?.output.predictions.g1.candidates[0]?.content).toBe("技術の話を続ける");
    expect(context?.recentExperienceEffect?.eventId).toBe("event-1");
    expect(context?.agentId).toBe("a");
    expect(await repository.latest("b")).toBeUndefined();
    expect((await pool.query<{ agent_id: string | null; source_event_id: string | null }>("SELECT agent_id,source_event_id FROM prediction_records WHERE id='prediction-2'")).rows[0]).toEqual({ agent_id: "a", source_event_id: "event-2" });
    expect((await pool.query<{ agent_id: string | null }>("SELECT agent_id FROM prediction_evaluations WHERE prediction_id='prediction-2'")).rows[0]?.agent_id).toBe("a");
    await expect(repository.save({ ...record("prediction-invalid"), agentId: "b" })).rejects.toThrow("Prediction source Run does not match");
  });

  it("normalizes obsolete stored fields from a real database record", async () => {
    const legacy = {
      ...record("prediction-legacy", "event-legacy", "2026-11-01T00:00:00.000Z"), sourceRunId: "run-legacy",
      output: { ...record("prediction-legacy").output, remember: [{ content: "obsolete" }], observationCandidates: [{ summary: "obsolete" }] }
    };
    await pool.query("INSERT INTO prediction_records(id,agent_id,source_event_id,source_run_id,output,created_at) VALUES ($1,$2,$3,$4,$5,$6)", [legacy.id, legacy.agentId, legacy.sourceEventId, legacy.sourceRunId, legacy.output, legacy.createdAt]);
    const repository = new PostgresPredictionRepository(createRuntimeDatabase(pool));
    const loaded = await repository.latest("a");
    const context = await repository.context("a");
    expect(loaded?.id).toBe("prediction-legacy");
    expect(loaded?.output).not.toHaveProperty("remember");
    expect(loaded?.output).not.toHaveProperty("observationCandidates");
    expect(context?.previousPrediction?.id).toBe("prediction-legacy");
  });

  it("NFR-7, NFR-8: validates and persists the G3 work-item ownership snapshot", async () => {
    const predictions = new PostgresPredictionRepository(createRuntimeDatabase(pool));
    await predictions.save(record("prediction-g3", "event-1"));
    const task: G3Task = { id: "g3-task", agentId: "a", sourcePredictionId: "prediction-g3", sourceEventId: "event-1", sourceRunId: "run-1", status: "pending", attempt: 0, deadlineAt: "2026-10-31T00:01:00Z", input: { agentId: "a", sourcePredictionId: "prediction-g3", sourceEventId: "event-1", sourceRunId: "run-1", observation: { eventId: "event-1", summary: "G3", facts: [], observedAt: "2026-10-31T00:00:00Z" }, prediction: record("prediction-g3").output }, createdAt: "2026-10-31T00:00:00Z" };
    const repository = new PostgresG3TaskRepository(createRuntimeDatabase(pool), "a");
    await repository.save(task);
    expect((await pool.query("SELECT agent_id,source_prediction_id,source_event_id,source_run_id,status,attempt,deadline_at,lease_until FROM g3_tasks WHERE id='g3-task'")).rows[0]).toMatchObject({ agent_id: "a", source_prediction_id: "prediction-g3", source_event_id: "event-1", source_run_id: "run-1", status: "pending", attempt: 0 });
    const claimed = await repository.claim("g3-task", "2026-10-31T00:00:01Z", "2026-10-31T00:00:30Z", 3);
    expect(claimed).toMatchObject({ status: "running", attempt: 1 });
    if (claimed?.leaseUntil === undefined) throw new Error("G3 task was not leased");
    const result = { output: { hypothesisEvaluations: [], newHypotheses: [], findings: ["確認済み"], memories: [] }, toolEvidence: [] };
    await expect(repository.saveResult("g3-task", "2026-10-31T00:00:29Z", result)).resolves.toBe(false);
    await expect(repository.saveResult("g3-task", claimed.leaseUntil, result)).resolves.toBe(true);
    await expect(repository.complete("g3-task", "2026-10-31T00:00:29Z", result, "2026-10-31T00:00:10Z")).resolves.toBe(false);
    await expect(repository.complete("g3-task", claimed.leaseUntil, result, "2026-10-31T00:00:10Z")).resolves.toBe(true);
    expect((await pool.query("SELECT count(*)::int AS count FROM events WHERE id LIKE 'g3-task:%'")).rows[0]).toEqual({ count: 0 });
    const reclaimTask: G3Task = { ...task, id: "g3-reclaim", deadlineAt: "2026-10-31T00:10:00Z" };
    await repository.save(reclaimTask);
    const firstLease = await repository.claim("g3-reclaim", "2026-10-31T00:01:00Z", "2026-10-31T00:02:00Z", 3);
    if (firstLease?.leaseUntil === undefined) throw new Error("reclaim task was not initially leased");
    await expect(repository.saveResult("g3-reclaim", firstLease.leaseUntil, result)).resolves.toBe(true);
    const reclaimed = await repository.claimDue("2026-10-31T00:03:00Z", "2026-10-31T00:04:00Z", 3);
    expect(reclaimed).toMatchObject({ id: "g3-reclaim", status: "result-pending", attempt: 2, output: { findings: ["確認済み"] } });
    await expect(repository.claimDue("2026-10-31T00:03:30Z", "2026-10-31T00:04:30Z", 2)).resolves.toBeUndefined();
    expect((await pool.query<{ status: string }>("SELECT status FROM g3_tasks WHERE id='g3-reclaim'")).rows[0]?.status).toBe("result-pending");
    await expect(repository.claimDue("2026-10-31T00:05:00Z", "2026-10-31T00:06:00Z", 2)).resolves.toBeUndefined();
    expect((await pool.query<{ status: string; failure_reason: string }>("SELECT status,failure_reason FROM g3_tasks WHERE id='g3-reclaim'")).rows[0]).toMatchObject({ status: "failed", failure_reason: "G3 task attempt limit exceeded" });
    await pool.query("INSERT INTO g3_tasks(id,agent_id,source_prediction_id,source_event_id,status,attempt,input,created_at) VALUES ('g3-legacy','a','legacy','event-1','pending',0,'{}','2026-10-01T00:00:00Z'),('g3-other','b','other','other-event','pending',0,'{}','2026-10-31T00:00:00Z')");
    await expect(repository.claimDue("2026-10-31T00:02:00Z", "2026-10-31T00:03:00Z", 3)).resolves.toBeUndefined();
    expect((await pool.query<{ status: string }>("SELECT status FROM g3_tasks WHERE id='g3-legacy'")).rows[0]?.status).toBe("failed");
    expect((await pool.query<{ status: string }>("SELECT status FROM g3_tasks WHERE id='g3-other'")).rows[0]?.status).toBe("pending");
    await expect(repository.save({ ...task, id: "g3-invalid", sourceRunId: "run-legacy" })).rejects.toThrow("G3 Task source Prediction does not match");
  });
});
