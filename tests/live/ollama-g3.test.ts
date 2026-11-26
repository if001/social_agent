import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { G3Service } from "../../src/application/g3.js";
import { loadConfig } from "../../src/config/config.js";
import { createOllamaG3Model } from "../../src/infrastructure/agent/g3-harness.js";
import { migrate } from "../../src/infrastructure/persistence/postgres.js";
import { PostgresG3TaskRepository } from "../../src/infrastructure/persistence/postgres-g3-task-repository.js";
import { PostgresPredictionRepository } from "../../src/infrastructure/persistence/postgres-prediction-repository.js";
import { createRuntimeDatabase } from "../../src/infrastructure/persistence/runtime-database.js";
import { errorLogContext } from "../../src/observability/logger.js";
import { initializeAgent } from "../../src/operations/operations.js";

function postgresUrl(connectionString: string): URL { return new URL(connectionString.replace("postgresql+psycopg://", "postgresql://")); }
function databaseUrl(connectionString: string, database: string): string { const url = postgresUrl(connectionString); url.pathname = `/${database}`; return url.toString(); }
function identifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }

describe("live Ollama G3", () => {
  it("FR-51, NFR-20: completes a real G3 task and stores its structured result in PostgreSQL", async () => {
    const config = await loadConfig();
    const database = `live_g3_${randomUUID().replaceAll("-", "")}`;
    const runtimeRole = decodeURIComponent(postgresUrl(config.database.url).username);
    const control = new Pool({ connectionString: config.database.adminUrl.replace("postgresql+psycopg://", "postgresql://"), max: 1 });
    const adminPool = new Pool({ connectionString: databaseUrl(config.database.adminUrl, database), options: "-c search_path=app,public,ext", max: 2 });
    const pool = new Pool({ connectionString: databaseUrl(config.database.url, database), options: "-c search_path=app,public,ext", max: 4 });
    try {
      await control.query(`CREATE DATABASE ${identifier(database)}`);
      await adminPool.query("CREATE SCHEMA app"); await migrate(adminPool);
      await control.query(`GRANT CONNECT ON DATABASE ${identifier(database)} TO ${identifier(runtimeRole)}`);
      await adminPool.query(`GRANT USAGE ON SCHEMA app TO ${identifier(runtimeRole)}`);
      await adminPool.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA app TO ${identifier(runtimeRole)}`);
      await initializeAgent(pool, {
        version: 1,
        family: { id: "live-g3-family", name: "Live G3", sharedDisposition: "観察を言語化する", baseInstruction: "会話を続ける" },
        agent: { id: "live-g3-agent", identity: "Live G3 Agent", initialDisposition: "観察を確かめる", raisonDetre: "経験を意味づける", selfNarrative: "検証中", selfContinuity: "経験を次へつなぐ" },
        initialState: { mood: {}, concerns: [], relationships: [] }
      });
      const occurredAt = new Date().toISOString();
      await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('live-g3-event','live-g3-agent','user-message','{}','live-test','completed',$1)", [occurredAt]);
      await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,started_at,finished_at) VALUES ('live-g3-run','live-g3-agent','live-g3-event',0,$1,$1)", [occurredAt]);
      const prediction = { predictions: { g1: { candidates: [] }, g2: { candidates: [] } }, predictionEvaluations: [], g3: { needsG3: true as const, targetLayers: ["L4" as const], priority: "medium" as const } };
      await new PostgresPredictionRepository(createRuntimeDatabase(pool)).save({ id: "live-g3-prediction", agentId: "live-g3-agent", sourceEventId: "live-g3-event", sourceRunId: "live-g3-run", output: prediction, createdAt: occurredAt });
      const service = new G3Service(
        new PostgresG3TaskRepository(createRuntimeDatabase(pool), "live-g3-agent"),
        createOllamaG3Model(config.chat),
        { handle: () => Promise.resolve() },
        { next: () => "live-g3-task" },
        () => new Date(),
        300_000,
        300_000,
        1
      );
      const output = await service.run({ agentId: "live-g3-agent", sourceEventId: "live-g3-event", sourceRunId: "live-g3-run", sourcePredictionId: "live-g3-prediction", observation: { eventId: "live-g3-event", summary: "ユーザーは小さな展示を見に行き、予想より音の作品が印象に残ったと話した", facts: ["展示を見に行った", "音の作品が印象に残った"], observedAt: occurredAt }, prediction }, AbortSignal.timeout(300_000));
      const task = (await pool.query("SELECT status,output,failure_reason FROM g3_tasks WHERE id='live-g3-task'")).rows[0];
      if (output === undefined) throw new Error(`G3 task did not complete: ${JSON.stringify(task)}`);
      expect(output?.memories).toBeInstanceOf(Array);
      expect(task).toMatchObject({ status: "completed", failure_reason: null });
    } catch (error) {
      throw new Error(`Live G3 failed: ${JSON.stringify(errorLogContext(error))}`);
    } finally {
      await pool.end(); await adminPool.end();
      await control.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [database]);
      await control.query(`DROP DATABASE IF EXISTS ${identifier(database)}`); await control.end();
    }
  });
});
