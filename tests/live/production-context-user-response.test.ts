import { randomUUID } from "node:crypto";
import { Pool } from "pg";

import { OutboxDispatcher } from "../../src/application/agent-runtime.js";
import { createBotComposition } from "../../src/bootstrap/bot-composition.js";
import { loadConfig } from "../../src/config/config.js";
import type { MessageEnvelope } from "../../src/domain/contracts.js";
import { migrate } from "../../src/infrastructure/persistence/postgres.js";
import { errorLogContext } from "../../src/observability/logger.js";
import { initializeAgent } from "../../src/operations/operations.js";
import { messageFixture } from "../../src/testing/contract-fixtures.js";

describe("production-like text UI user response", () => {
  it("loads PostgreSQL context and production Tools, calls Ollama, commits, and dispatches", async () => {
    const loaded = await loadConfig(); const databaseUrl = loaded.database.url.replace("postgresql+psycopg://", "postgresql://");
    const schema = `live_e2e_${randomUUID().replaceAll("-", "")}`; const control = new Pool({ connectionString: databaseUrl, max: 1 });
    const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public,ext`, max: 4 });
    const published: MessageEnvelope[] = []; let receive: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const queue = { publish: (message: MessageEnvelope) => { published.push(message); return Promise.resolve(); }, subscribe: (_destination: string, handler: (message: MessageEnvelope) => Promise<void>) => { receive = handler; return Promise.resolve(); } };
    try {
      await control.query(`CREATE SCHEMA ${schema}`); await migrate(pool);
      await initializeAgent(pool, {
        version: 1,
        family: { id: "live-family", name: "Live E2E", sharedDisposition: "事実を確認し、簡潔に応答する", baseInstruction: "ユーザー入力へ日本語で回答する" },
        agent: { id: "live-e2e-agent", identity: "Live E2E Agent", initialDisposition: "落ち着いて誠実に応答する", values: "正確さ", interests: ["対話"], preferences: ["簡潔な表現"], roles: ["対話相手"], selfNarrative: "対話を始めた", selfContinuity: "経験を次の応答へつなぐ" },
        initialState: { mood: "落ち着いている", concerns: [], relationships: [] }
      });
      const config = { ...loaded, botId: "live-e2e-agent", defaultOutputDestination: "text-user", runDeadlineMs: Math.max(loaded.runDeadlineMs, 300_000) };
      const composition = createBotComposition({ pool, config, queue, limits: { maxToolCalls: 25, maxSteps: 27 } });
      expect(composition.toolRegistry.definitions().length).toBeGreaterThanOrEqual(10);
      await composition.runtime.start(new AbortController().signal);
      try { await receive?.(messageFixture({ id: "production-like-user-message", destination: "live-e2e-agent", source: "text-user", replyTo: "text-user", sentAt: "2026-10-12T00:00:00.000Z", availableAt: "2026-10-12T00:00:00.000Z", expiresAt: "2026-10-13T00:00:00.000Z", payload: { type: "user-message", text: "動作確認です。日本語で一文だけ返答してください。", sourceType: "terminal" } })); }
      catch (error) { throw new Error(`Production-like live Agent failed: ${JSON.stringify(errorLogContext(error))}`); }
      expect((await pool.query("SELECT 1 FROM message_receipts WHERE message_id='production-like-user-message'")).rowCount).toBe(1);
      expect((await pool.query("SELECT 1 FROM agent_runs WHERE agent_id='live-e2e-agent' AND finished_at IS NOT NULL")).rowCount).toBe(1);
      expect((await pool.query("SELECT 1 FROM outbox_messages WHERE agent_id='live-e2e-agent' AND sent_at IS NULL")).rowCount).toBe(1);
      await expect(new OutboxDispatcher(composition.persistence, queue).dispatch()).resolves.toBe(1);
      expect(published).toHaveLength(1); expect(published[0]?.destination).toBe("text-user");
      expect(published[0]?.payload).toMatchObject({ type: "agent-response", agentId: "live-e2e-agent" });
      const responsePayload = published[0]?.payload;
      expect(responsePayload !== undefined && responsePayload.type === "agent-response" && typeof responsePayload.text === "string" && responsePayload.text.trim().length > 0).toBe(true);
      const autonomousAction = await (async () => {
        try {
          return await composition.runtime.process({ id: "production-like-idle", agentId: "live-e2e-agent", kind: "internal", occurredAt: "2026-10-12T00:05:00.000Z", payload: { targetKind: "idle", schedulerGenerated: true, reason: "現在の状態から小さな行動を検討する", destination: "text-user" } }, new AbortController().signal);
        } catch (error) {
          throw new Error(`Production-like idle Agent failed: ${JSON.stringify(errorLogContext(error))}`);
        }
      })();
      expect(["respond", "refuse", "notify-no-execution", "no-external-action"]).toContain(autonomousAction.type);
      expect((await pool.query("SELECT 1 FROM agent_runs WHERE agent_id='live-e2e-agent' AND finished_at IS NOT NULL")).rowCount).toBe(2);
    } finally {
      await pool.end(); await control.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await control.end();
    }
  });
});
