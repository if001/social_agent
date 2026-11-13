import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { OutboxDispatcher } from "../../src/application/agent-runtime.js";
import { createBotComposition } from "../../src/bootstrap/bot-composition.js";
import { loadConfig } from "../../src/config/config.js";
import type { MessageEnvelope } from "../../src/domain/contracts.js";
import { migrate } from "../../src/infrastructure/persistence/postgres.js";
import { createStdoutLogger, errorLogContext } from "../../src/observability/logger.js";
import { initializeAgent } from "../../src/operations/operations.js";
import { messageFixture } from "../../src/testing/contract-fixtures.js";

function postgresUrl(connectionString: string): URL {
  return new URL(connectionString.replace("postgresql+psycopg://", "postgresql://"));
}
function databaseUrl(connectionString: string, database: string): string {
  const url = postgresUrl(connectionString); url.pathname = `/${database}`; return url.toString();
}
function identifier(value: string): string { return `"${value.replaceAll('"', '""')}"`; }

describe("production-like text UI user response", () => {
  it("FR-2, FR-33, NFR-8, AC-3: loads PostgreSQL context and production Tools, calls Ollama, commits, and dispatches", async () => {
    const now = new Date();
    const sentAt = now.toISOString();
    const expiresAt = new Date(now.getTime() + 86_400_000).toISOString();
    const loaded = await loadConfig();
    const database = `live_e2e_${randomUUID().replaceAll("-", "")}`;
    const runtimeRole = decodeURIComponent(postgresUrl(loaded.database.url).username);
    const control = new Pool({ connectionString: loaded.database.adminUrl.replace("postgresql+psycopg://", "postgresql://"), max: 1 });
    const adminPool = new Pool({ connectionString: databaseUrl(loaded.database.adminUrl, database), options: "-c search_path=app,public,ext", max: 2 });
    const pool = new Pool({ connectionString: databaseUrl(loaded.database.url, database), options: "-c search_path=app,public,ext", max: 4 });
    const diagnosticLogs: string[] = []; const logger = createStdoutLogger({}, (line) => { diagnosticLogs.push(line.trim()); });
    const published: MessageEnvelope[] = []; let receive: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const queue = { publish: (message: MessageEnvelope) => { published.push(message); return Promise.resolve(); }, subscribe: (_destination: string, handler: (message: MessageEnvelope) => Promise<void>) => { receive = handler; return Promise.resolve(); } };
    try {
      await control.query(`CREATE DATABASE ${identifier(database)}`);
      await adminPool.query("CREATE SCHEMA app"); await migrate(adminPool);
      await control.query(`GRANT CONNECT ON DATABASE ${identifier(database)} TO ${identifier(runtimeRole)}`);
      await adminPool.query(`GRANT USAGE ON SCHEMA app TO ${identifier(runtimeRole)}`);
      await adminPool.query(`GRANT SELECT,INSERT,UPDATE,DELETE ON ALL TABLES IN SCHEMA app TO ${identifier(runtimeRole)}`);
      await initializeAgent(pool, {
        version: 1,
        family: { id: "live-family", name: "Live E2E", sharedDisposition: "事実を確認し、簡潔に応答する", baseInstruction: "ユーザー入力へ日本語で回答する" },
        agent: { id: "live-e2e-agent", identity: "Live E2E Agent", initialDisposition: "正確で簡潔な対話が好きで、根拠のない断定は嫌い", raisonDetre: "誠実な対話を続ける", selfNarrative: "対話を始めた", selfContinuity: "経験を次の応答へつなぐ" },
        initialState: { mood: "落ち着いている", concerns: [], relationships: [] }
      });
      await pool.query("INSERT INTO prediction_records(id,agent_id,source_event_id,source_run_id,output,created_at) VALUES ('legacy-prediction','live-e2e-agent','legacy-event','legacy-run',$1,now())", [JSON.stringify({
        predictions: { g1: { candidates: [] }, g2: { candidates: [] } }, predictionEvaluations: [],
        g3: { needsG3: false, targetLayers: [], priority: "medium" }, remember: [], observationCandidates: []
      })]);
      const config = { ...loaded, botId: "live-e2e-agent", defaultOutputDestination: "text-user", runDeadlineMs: Math.max(loaded.runDeadlineMs, 300_000) };
      const composition = createBotComposition({ pool, config, queue, logger, limits: { maxToolCalls: 0, maxSteps: 2 } });
      expect(composition.toolRegistry.definitions().length).toBeGreaterThanOrEqual(10);
      await composition.runtime.start(new AbortController().signal);
      try { await receive?.(messageFixture({ id: "production-like-user-message", destination: "live-e2e-agent", source: "text-user", replyTo: "text-user", sentAt, availableAt: sentAt, expiresAt, payload: { type: "user-message", text: "動作確認です。日本語で一文だけ返答してください。", sourceType: "terminal" } })); }
      catch (error) { throw new Error(`Production-like live Agent failed: ${JSON.stringify(errorLogContext(error))}`); }
      expect((await pool.query("SELECT 1 FROM message_receipts WHERE message_id='production-like-user-message'")).rowCount).toBe(1);
      expect((await pool.query("SELECT 1 FROM agent_runs WHERE agent_id='live-e2e-agent' AND finished_at IS NOT NULL")).rowCount).toBe(1);
      expect((await pool.query("SELECT 1 FROM outbox_messages WHERE agent_id='live-e2e-agent' AND sent_at IS NULL")).rowCount).toBe(1);
      await expect(new OutboxDispatcher(composition.persistence, queue).dispatch()).resolves.toBe(1);
      expect(published).toHaveLength(1); expect(published[0]?.destination).toBe("text-user");
      expect(published[0]?.payload).toMatchObject({ type: "agent-response", agentId: "live-e2e-agent" });
      const responsePayload = published[0]?.payload;
      expect(responsePayload !== undefined && responsePayload.type === "agent-response" && typeof responsePayload.text === "string" && responsePayload.text.trim().length > 0).toBe(true);
      expect((await pool.query("SELECT 1 FROM agent_runs WHERE agent_id='live-e2e-agent' AND finished_at IS NOT NULL")).rowCount).toBe(1);
    } finally {
      await pool.end(); await adminPool.end();
      await control.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname=$1 AND pid<>pg_backend_pid()", [database]);
      await control.query(`DROP DATABASE IF EXISTS ${identifier(database)}`); await control.end();
    }
  });
});
