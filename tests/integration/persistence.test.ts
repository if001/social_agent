import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Pool } from "pg";
import { z } from "zod";
import { DomainError, type Concern } from "../../src/domain/contracts.js";

import { AgentStateRepository, PostgresUnitOfWork, withAgentLock } from "../../src/infrastructure/persistence/postgres.js";
import { PostgresEventTransaction } from "../../src/infrastructure/persistence/event-transaction.js";
import { messageFixture } from "../../src/testing/contract-fixtures.js";
import { PostgresMemoryRetriever } from "../../src/infrastructure/persistence/postgres-memory-retriever.js";
import { PostgresScheduleRepository } from "../../src/infrastructure/persistence/postgres-schedule-repository.js";
import { PostgresScheduledTaskToolRepository } from "../../src/infrastructure/persistence/postgres-scheduled-task-tool-repository.js";
import { PostgresAgentContextToolRepository } from "../../src/infrastructure/persistence/postgres-agent-context-tool-repository.js";
import { PostgresRuntimePersistence } from "../../src/infrastructure/persistence/postgres-runtime-persistence.js";
import { PostgresObservationGateContext } from "../../src/infrastructure/persistence/postgres-observation-gate-context.js";
import { PostgresExperienceIntegrationRepository } from "../../src/infrastructure/persistence/postgres-experience-integration.js";
import { PostgresReflectionRepository } from "../../src/infrastructure/persistence/postgres-reflection.js";
import { SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { agentCoreInputFixture, fixtureInstant } from "../../src/testing/contract-fixtures.js";
import { PostgresAgentContextLoader } from "../../src/infrastructure/persistence/postgres-agent-context-loader.js";
import { FakeEmbeddingProvider } from "../../src/infrastructure/embedding/ollama-embedding.js";
import { ToolRegistry } from "../../src/application/tool-registry.js";
import { BotHost } from "../../src/bootstrap/bot-host.js";
import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";
import { PostgresMemoryEmbeddingLifecycle } from "../../src/infrastructure/persistence/postgres-memory-embedding.js";
import { PostgresConcernEmbeddingLifecycle } from "../../src/infrastructure/persistence/postgres-concern-embedding.js";
import { PostgresWebArchive } from "../../src/infrastructure/persistence/postgres-web-archive.js";
import { createWebTools } from "../../src/infrastructure/tools/web-tools.js";
import { createScheduledTaskTools } from "../../src/infrastructure/tools/scheduled-task-tools.js";
import { createAgentContextTools } from "../../src/infrastructure/tools/agent-context-tools.js";
import { createCanonicalSubjectResolver } from "../../src/application/canonical-subject.js";
import { initializeAgent } from "../../src/operations/operations.js";
import { AgentRuntime } from "../../src/application/agent-runtime.js";
import { normalizeOverfullMemoryEvidence } from "../../src/application/memory-evidence-normalization.js";
import type { ReflectionInput } from "../../src/application/reflection.js";
import { createIntegrationDatabase, integrationDatabaseConfigured } from "../support/integration-database.js";
import { createRuntimeDatabase } from "../../src/infrastructure/persistence/runtime-database.js";
import { agentFamilies, events, outboxMessages } from "../../src/infrastructure/persistence/schema.js";
import { migrateNormalizedEventStorage } from "../../scripts/migrate-normalized-event-storage.js";
import { migrateConcernReevaluationSignals } from "../../scripts/migrate-concern-reevaluation-signals.js";
import { backfillReflectionToolExecutions } from "../../scripts/backfill-reflection-tool-executions.js";
import { PostgresRetrievalService } from "../../src/infrastructure/persistence/postgres-retrieval-service.js";
import { PostgresConversationRepository } from "../../src/infrastructure/persistence/postgres-conversation-repository.js";

const describeDatabase = integrationDatabaseConfigured() ? describe : describe.skip;

describeDatabase("PostgreSQL persistence", () => {
  let database: ReturnType<typeof createIntegrationDatabase>;
  let pool: Pool;
  const recordExperience = async (eventId: string, summary: string) => {
    await pool.query("INSERT INTO event_experiences(event_id,summary,facts) VALUES ($1,$2,'[]') ON CONFLICT (event_id) DO NOTHING", [eventId, summary]);
  };
  const setConcerns = async (agentId: string, values: readonly Concern[]) => {
    await pool.query("DELETE FROM concern_activities WHERE concern_id IN (SELECT id FROM concerns WHERE agent_id=$1) OR source_concern_id IN (SELECT id FROM concerns WHERE agent_id=$1)", [agentId]);
    await pool.query("DELETE FROM concerns WHERE agent_id=$1", [agentId]);
    for (const concern of values) await pool.query("INSERT INTO concerns(id,agent_id,description,why_it_matters,status) VALUES ($1,$2,$3,$4,$5)", [concern.id, agentId, concern.description, concern.whyItMatters, concern.status]);
  };
  const getConcerns = async (agentId: string): Promise<readonly Concern[]> => (await pool.query<{ id: string; description: string; why_it_matters: string; status: Concern["status"] }>("SELECT id,description,why_it_matters,status FROM concerns WHERE agent_id=$1 AND deleted_at IS NULL ORDER BY created_at,id", [agentId])).rows.map((row) => ({ id: row.id, description: row.description, whyItMatters: row.why_it_matters, status: row.status }));

  beforeAll(async () => {
    database = createIntegrationDatabase(); pool = database.pool;
    await database.prepare();
    await pool.query("INSERT INTO agent_families(id,name,shared_disposition,base_instruction) VALUES ('family','Family','Curious','Help')");
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ('a','family','Agent A','Calm'),('b','family','Agent B','Bold')");
    for (const agentId of ["a", "b"]) await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,relationships,mood) VALUES ($1,'Careful learner','Growing continuously','[\"Care\"]','[]','Calm')", [agentId]);
    await pool.query("DELETE FROM concern_activities WHERE concern_id IN (SELECT id FROM concerns WHERE agent_id=ANY($1::text[])) OR source_concern_id IN (SELECT id FROM concerns WHERE agent_id=ANY($1::text[]))", [["a", "b"]]);
    await pool.query("DELETE FROM concerns WHERE agent_id=ANY($1::text[])", [["a", "b"]]);
  });
  afterAll(async () => {
    await database.close();
  });

  it("FR-6, NFR-10: round-trips isolated agent state and rejects stale versions", async () => {
    const repository = new AgentStateRepository(createRuntimeDatabase(pool).db);
    expect((await repository.find<{ agentId: string }>("a"))?.agentId).toBe("a");
    expect(await repository.find("missing")).toBeUndefined();
    await expect(repository.update("a", 0, { mood: "Focused" })).resolves.toBe(1);
    await expect(repository.update("a", 0, { mood: "Stale" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repository.find<{ mood: string }>("b"))?.mood).toBe("Calm");
    expect((await repository.find<{ commitments: string[] }>("a"))).toMatchObject({ commitments: ["Care"] });
  });

  it("NFR-8, NFR-11: exposes typed Drizzle CRUD and rolls back a repository transaction", async () => {
    const runtimeDatabase = createRuntimeDatabase(pool);
    await runtimeDatabase.transaction(async (transaction) => {
      await transaction.insert(agentFamilies).values({ id: "drizzle-commit", name: "Drizzle Commit", sharedDisposition: "Typed", baseInstruction: "Persist" });
    });
    expect((await pool.query("SELECT id FROM agent_families WHERE id='drizzle-commit'")).rowCount).toBe(1);
    await expect(runtimeDatabase.transaction(async (transaction) => {
      await transaction.insert(agentFamilies).values({ id: "drizzle-rollback", name: "Drizzle Rollback", sharedDisposition: "Typed", baseInstruction: "Rollback" });
      throw new Error("rollback");
    })).rejects.toThrow("rollback");
    expect((await pool.query("SELECT id FROM agent_families WHERE id='drizzle-rollback'")).rowCount).toBe(0);
    await pool.query("DELETE FROM agent_families WHERE id='drizzle-commit'");
  });

  it("normalizes an over-limit Memory before Reflection reloads it", async () => {
    const evidence = Array.from({ length: 17 }, (_, index) => `stale-evidence-${String(index + 1)}`);
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,evidence_event_ids) VALUES ('over-limit-evidence','a','semantic','以前の根拠が過剰に蓄積した','要整理',now(),$1)", [JSON.stringify(evidence)]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('normalization-event','a','internal',$1,'test','completed',now())", [{ summary: "根拠を正規化した" }]);
    await recordExperience("normalization-event", "根拠を正規化した");
    await expect(normalizeOverfullMemoryEvidence(pool, { agentId: "a", apply: false })).resolves.toEqual({ scanned: 1, normalized: 0 });
    await expect(normalizeOverfullMemoryEvidence(pool, { agentId: "a", apply: true })).resolves.toEqual({ scanned: 1, normalized: 1 });
    expect((await pool.query<{ evidence_event_ids: string[] }>("SELECT evidence_event_ids FROM memories WHERE id='over-limit-evidence'")).rows[0]?.evidence_event_ids).toEqual([]);
    const repository = new PostgresReflectionRepository(createRuntimeDatabase(pool), new SequenceIdGenerator([]), () => new Date("2026-11-14T00:00:00Z"));
    const input = await repository.load("normalization-reflection", "a");
    if (input === undefined) throw new Error("Reflection input was not created");
    const refreshed = await repository.refresh(input);
    expect(refreshed.reflectionId).toBe("normalization-reflection");
    expect(refreshed.memories.find(({ id }) => id === "over-limit-evidence")?.evidenceEventIds).toEqual([]);
    await pool.query("DELETE FROM reflection_runs WHERE id='normalization-reflection'");
    await pool.query("DELETE FROM memories WHERE id='over-limit-evidence'");
    await pool.query("DELETE FROM events WHERE id='normalization-event'");
  });

  it("FR-6, FR-7: initializes configured Self and preserves acquired experience on reapply", async () => {
    const config = {
      version: 1 as const,
      family: { id: "configured-family", name: "Configured", sharedDisposition: "共通傾向", baseInstruction: "根拠を区別する" },
      agent: { id: "configured-agent", identity: "Configured Agent", initialDisposition: "具体的な対象を調べることが好きで、根拠のない断定は嫌い", raisonDetre: "対話相手との約束を守る", selfNarrative: "始まったばかり", selfContinuity: "経験をつなぐ" },
      initialState: { mood: "中立", concerns: [], relationships: [] }
    };
    const initialTimings = { autonomyReviewIntervalMs: 2_000, stateReviewIntervalMs: 3_000 };
    await initializeAgent(pool, config, initialTimings);
    expect((await pool.query<{ kind: string }>("SELECT kind FROM autonomous_schedules WHERE agent_id=$1 AND kind='idle'", [config.agent.id])).rows).toEqual([{ kind: "idle" }]);
    expect((await pool.query<{ kind: string; delay_ms: number }>("SELECT kind,round(extract(epoch FROM (next_due_at-updated_at))*1000)::int AS delay_ms FROM autonomous_schedules WHERE agent_id=$1 ORDER BY kind", [config.agent.id])).rows).toEqual([{ kind: "concern-formation", delay_ms: 2_000 }, { kind: "idle", delay_ms: 2_000 }, { kind: "reflection", delay_ms: 3_000 }]);
    await pool.query("UPDATE agent_states SET disposition='経験で得た傾向',mood='持続する気分',relationships=$2 WHERE agent_id=$1", [config.agent.id, JSON.stringify([{ subjectId: "owner", description: "継続する関係" }])]);
    await setConcerns(config.agent.id, [{ id: "concern-existing", description: "継続中の関心", whyItMatters: "大切", status: "active" }]);
    await initializeAgent(pool, { ...config, agent: { ...config.agent, initialDisposition: "再適用された初期傾向" } }, initialTimings);
    const loaded = await pool.query<{ shared_disposition: string; initial_disposition: string; disposition: string; mood: string; relationships: unknown }>("SELECT f.shared_disposition,a.initial_disposition,s.disposition,s.mood,s.relationships FROM agents a JOIN agent_families f ON f.id=a.family_id JOIN agent_states s ON s.agent_id=a.id WHERE a.id=$1", [config.agent.id]);
    expect(loaded.rows[0]).toMatchObject({ shared_disposition: "共通傾向", initial_disposition: config.agent.initialDisposition, disposition: "経験で得た傾向", mood: "持続する気分", relationships: [{ subjectId: "owner" }] });
    expect(await getConcerns(config.agent.id)).toMatchObject([{ description: "継続中の関心" }]);
    const redesigned = await pool.query<{ disposition: string; self_story: string; commitments: string[]; relationships: unknown[] }>("SELECT disposition,self_story,commitments,relationships FROM agent_states WHERE agent_id=$1", [config.agent.id]);
    expect(redesigned.rows[0]?.disposition).toBe("経験で得た傾向"); expect(redesigned.rows[0]?.self_story).toContain("始まったばかり"); expect(redesigned.rows[0]?.commitments).toContain("対話相手との約束を守る"); expect(await getConcerns(config.agent.id)).toMatchObject([{ id: "concern-existing" }]); expect(redesigned.rows[0]?.relationships).toMatchObject([{ subjectId: "owner" }]);
    await initializeAgent(pool, { ...config, family: { ...config.family, sharedDisposition: "更新した共通傾向" }, agent: { ...config.agent, initialDisposition: "映像史とAI技術が好きで、誇張は嫌い" } }, initialTimings, { overwriteConfiguredSelf: true });
    const overwritten = await pool.query<{ shared_disposition: string; disposition: string; commitments: string[]; mood: string; relationships: unknown; version: number }>("SELECT f.shared_disposition,s.disposition,s.commitments,s.mood,s.relationships,s.version FROM agents a JOIN agent_families f ON f.id=a.family_id JOIN agent_states s ON s.agent_id=a.id WHERE a.id=$1", [config.agent.id]);
    expect(overwritten.rows[0]).toMatchObject({ shared_disposition: "更新した共通傾向", mood: "持続する気分", relationships: [{ subjectId: "owner" }], version: 1 });
    expect(await getConcerns(config.agent.id)).toMatchObject([{ description: "継続中の関心" }]);
    expect(overwritten.rows[0]?.disposition).toContain("更新した共通傾向");
    expect(overwritten.rows[0]?.disposition).toContain("映像史とAI技術が好き");
  });

  it("NFR-8: rolls back event and outbox as one unit", async () => {
    const unit = new PostgresUnitOfWork(pool);
    await expect(unit.transaction(async (client) => {
      await client.insert(events).values({ id: "event-rollback", agentId: "a", kind: "internal", observation: {}, source: "test", status: "processing", occurredAt: new Date() });
      await client.insert(outboxMessages).values({ id: "outbox-rollback", agentId: "a", envelope: {} });
      throw new Error("stop");
    })).rejects.toThrow("stop");
    expect((await pool.query("SELECT id FROM events WHERE id='event-rollback'")).rowCount).toBe(0);
    expect((await pool.query("SELECT id FROM outbox_messages WHERE id='outbox-rollback'")).rowCount).toBe(0);
  });

  it("NFR-10: serializes an agent advisory lock and releases it", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = withAgentLock(pool, 4242, () => held);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await expect(withAgentLock(pool, 4242, () => Promise.resolve(undefined))).rejects.toMatchObject({ code: "CONFLICT" });
    release(); await first;
    await expect(withAgentLock(pool, 4242, () => Promise.resolve("ok"))).resolves.toBe("ok");
  });

  it("NFR-8: commits receipt, event, state trace and outbox atomically and deduplicates", async () => {
    const transaction = new PostgresEventTransaction(new PostgresUnitOfWork(pool));
    const input = {
      destination: "agent:a", messageId: "incoming-1",
      event: { id: "event-1", agentId: "a", kind: "user-message", observation: { summary: "hello" }, source: "terminal", occurredAt: new Date() },
      run: { id: "run-1", inputStateVersion: 1, startedAt: new Date(), result: { action: "respond" } },
      stateValues: { mood: "Attentive" },
      changes: [{ id: "change-1", target: "mood", operation: "set" as const, before: "Focused", after: "Attentive", reason: "Greeting", evidenceIds: ["event-1"] }],
      outbox: [messageFixture({ id: "outbox-1", destination: "terminal" })]
    };
    await expect(transaction.commit(input)).resolves.toBe("committed");
    await expect(transaction.commit(input)).resolves.toBe("duplicate");
    expect((await pool.query<{ status: string }>("SELECT status FROM message_receipts WHERE message_id='incoming-1'")).rows[0]?.status).toBe("completed");
    expect((await pool.query<{ reason: string }>("SELECT reason FROM state_changes WHERE id='change-1'")).rows[0]?.reason).toBe("Greeting");
    expect((await pool.query("SELECT id FROM outbox_messages WHERE id='outbox-1'")).rowCount).toBe(1);
  });

  it("FR-24: never creates a schedule when a Concern changes", async () => {
    const transaction = new PostgresEventTransaction(new PostgresUnitOfWork(pool));
    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const concern = { id: "concern-schedule", description: "次回の確認方法を決める", whyItMatters: "約束の履行を確認するため", status: "active" as const };
    await expect(transaction.commit({
      destination: "agent:a", messageId: "incoming-concern-schedule",
      event: { id: "event-concern-schedule", agentId: "a", kind: "internal", observation: {}, source: "test", occurredAt: new Date() },
      run: { id: "run-concern-schedule", inputStateVersion: version, startedAt: new Date(), result: {} },
      stateValues: { concerns: [concern] }, changes: [], outbox: []
    })).resolves.toBe("committed");
    expect((await pool.query("SELECT id FROM autonomous_schedules WHERE agent_id='a' AND kind='concern-due'")).rowCount).toBe(0);

    const nextVersion = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    await expect(transaction.commit({
      destination: "agent:a", messageId: "incoming-concern-clear",
      event: { id: "event-concern-clear", agentId: "a", kind: "internal", observation: {}, source: "test", occurredAt: new Date() },
      run: { id: "run-concern-clear", inputStateVersion: nextVersion, startedAt: new Date(), result: {} },
      stateValues: { concerns: [{ ...concern, status: "satisfied" as const }] }, changes: [], outbox: []
    })).resolves.toBe("committed");
    expect((await pool.query("SELECT id FROM autonomous_schedules WHERE agent_id='a' AND kind='concern-due'")).rowCount).toBe(0);
    await setConcerns("a", []);
  });

  it("NFR-8: leaves no partial records after a version conflict", async () => {
    const transaction = new PostgresEventTransaction(new PostgresUnitOfWork(pool));
    await expect(transaction.commit({
      destination: "agent:a", messageId: "incoming-conflict",
      event: { id: "event-conflict", agentId: "a", kind: "internal", observation: {}, source: "test", occurredAt: new Date() },
      run: { id: "run-conflict", inputStateVersion: 0, startedAt: new Date(), result: {} }, stateValues: { mood: "Wrong" }, changes: [], outbox: []
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await pool.query("SELECT 1 FROM message_receipts WHERE message_id='incoming-conflict'")).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM events WHERE id='event-conflict'")).rowCount).toBe(0);
  });

  it("FR-10, NFR-1: combines lexical and vector retrieval with filters and agent isolation", async () => {
    const unit = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const opposite = Array.from({ length: 768 }, (_, index) => index === 1 ? 1 : 0);
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,embedding,embedding_model,embedding_status) VALUES ('memory-a1','a','semantic','typescript architecture','Relevant','2026-01-02',$1::vector,'test','ready'),('memory-a2','a','episodic','unrelated note','Relevant','2026-01-01',$2::vector,'test','ready'),('memory-b1','b','semantic','typescript secret','Relevant','2026-01-03',$1::vector,'test','ready')", [`[${unit.join(",")}]`, `[${opposite.join(",")}]`]);
    const retriever = new PostgresMemoryRetriever(pool);
    const found = await retriever.retrieve("a", { text: "typescript", keywords: ["typescript"], subjectIds: [], kinds: ["semantic"] }, unit, 5);
    expect(found.memories.map(({ id }) => id)).toEqual(["memory-a1"]);
    expect(found.memories.every(({ agentId }) => agentId === "a")).toBe(true);
  });

  it("FR-10, FR-31: ranks Japanese keyword, subject, priority and category candidates with a stable fallback", async () => {
    await pool.query(`INSERT INTO memories(id,agent_id,kind,content,importance,retrieval_priority,occurred_at,embedding_status) VALUES
      ('rank-episodic','a','episodic','来週の研究発表について相談した','予定','normal','2026-02-01','failed'),
      ('rank-semantic','a','semantic','発表では結論を先に伝えることを好む','明示された好み','normal','2026-01-20','pending'),
      ('rank-self','a','self-related','私は発表準備を整理して支援してきた','自己理解','normal','2026-01-10','pending'),
      ('rank-self-change','a','self-change','発表支援で自己認識が変化した','監査','critical','2026-02-02','pending'),
      ('rank-other-agent','b','semantic','研究発表の秘密','非公開','critical','2026-02-03','pending'),
      ('priority-high','a','episodic','古いが重要な記憶','重要','high','2025-01-01','pending'),
      ('priority-normal','a','episodic','新しい通常の記憶','通常','normal','2026-03-01','pending')`);
    await pool.query("INSERT INTO memory_subjects(memory_id,subject_id) VALUES ('rank-semantic','owner')");
    const retriever = new PostgresMemoryRetriever(pool);
    const query = { text: "研究発表", keywords: ["研究", "発表"], subjectIds: ["owner"], kinds: ["episodic", "semantic", "self-related"] as const };
    const first = await retriever.retrieve("a", query, [], 3);
    const second = await retriever.retrieve("a", query, [], 3);
    expect(first.memories.map(({ id }) => id)).toEqual(second.memories.map(({ id }) => id));
    expect(new Set(first.memories.map(({ kind }) => kind))).toEqual(new Set(["episodic", "semantic", "self-related"]));
    expect(first.memories.map(({ id }) => id)).not.toContain("rank-self-change");
    expect(first.memories.map(({ id }) => id)).not.toContain("rank-other-agent");
    expect(first.trace.find(({ memoryId }) => memoryId === "rank-semantic")?.matchedBy).toContain("subject");
    const priority = await retriever.retrieve("a", { text: "", keywords: [], subjectIds: [], kinds: ["episodic"] }, [], 20);
    expect(priority.memories.findIndex(({ id }) => id === "priority-high")).toBeLessThan(priority.memories.findIndex(({ id }) => id === "priority-normal"));
  });

  it("FR-10, NFR-1: embeds pending Memory after persistence and backfills failures without crossing Agent ownership", async () => {
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ('embedding-a','family','Embedding A','Calm'),('embedding-b','family','Embedding B','Calm')");
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,embedding_status) VALUES ('embedding-memory-a','embedding-a','episodic','remember a','Relevant',now(),'pending'),('embedding-memory-b','embedding-b','episodic','remember b','Relevant',now(),'pending')");
    const vector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const lifecycle = new PostgresMemoryEmbeddingLifecycle(createRuntimeDatabase(pool), new FakeEmbeddingProvider({ "remember a": vector, "remember b": vector }), "fake-embed");
    await expect(lifecycle.embedMemoryIds("embedding-a", ["embedding-memory-a", "embedding-memory-b"])).resolves.toEqual({ attempted: 1, ready: 1, failed: 0 });
    expect((await pool.query<{ embedding_status: string; embedding_model: string; embedding_dimension: number }>("SELECT embedding_status,embedding_model,embedding_dimension FROM memories WHERE id='embedding-memory-a'")).rows[0]).toEqual({ embedding_status: "ready", embedding_model: "fake-embed", embedding_dimension: 768 });
    expect((await pool.query<{ embedding_status: string }>("SELECT embedding_status FROM memories WHERE id='embedding-memory-b'")).rows[0]?.embedding_status).toBe("pending");
    await expect(lifecycle.embedMemoryIds("embedding-a", ["embedding-memory-a"])).resolves.toEqual({ attempted: 0, ready: 0, failed: 0 });

    const failing = new PostgresMemoryEmbeddingLifecycle(createRuntimeDatabase(pool), { dimension: 768, embed: () => Promise.reject(new Error("provider unavailable")) }, "fake-embed");
    await expect(failing.embedMemoryIds("embedding-b", ["embedding-memory-b"])).resolves.toEqual({ attempted: 1, ready: 0, failed: 1 });
    expect((await pool.query<{ embedding_status: string; embedding_error: string }>("SELECT embedding_status,embedding_error FROM memories WHERE id='embedding-memory-b'")).rows[0]).toEqual({ embedding_status: "failed", embedding_error: "provider unavailable" });
    await expect(lifecycle.backfill({ agentId: "embedding-b" })).resolves.toEqual({ attempted: 1, ready: 1, failed: 0 });
  });

  it("FR-69, NFR-1: embeds active Concerns and backfills only the owning Agent's pending retrieval index", async () => {
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ('concern-embedding-a','family','Concern embedding A','Calm'),('concern-embedding-b','family','Concern embedding B','Calm')");
    await pool.query("INSERT INTO concerns(id,agent_id,description,why_it_matters,status,embedding_status) VALUES ('concern-embedding-a','concern-embedding-a','変質の条件を調べる','比較したい','active','pending'),('concern-embedding-b','concern-embedding-b','別の関心','比較したい','active','pending')");
    const vector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const memoryEmbedding = new PostgresMemoryEmbeddingLifecycle(createRuntimeDatabase(pool), new FakeEmbeddingProvider({ "変質の条件を調べる\n比較したい": vector, "別の関心\n比較したい": vector }), "fake-embed");
    const lifecycle = new PostgresConcernEmbeddingLifecycle(createRuntimeDatabase(pool), memoryEmbedding);
    await expect(lifecycle.embedConcernIds("concern-embedding-a", ["concern-embedding-a", "concern-embedding-b"])).resolves.toEqual({ attempted: 1, ready: 1, failed: 0 });
    expect((await pool.query<{ embedding_status: string; embedding_model: string; embedding_dimension: number }>("SELECT embedding_status,embedding_model,embedding_dimension FROM concerns WHERE id='concern-embedding-a'")).rows[0]).toEqual({ embedding_status: "ready", embedding_model: "fake-embed", embedding_dimension: 768 });
    expect((await pool.query<{ embedding_status: string }>("SELECT embedding_status FROM concerns WHERE id='concern-embedding-b'")).rows[0]?.embedding_status).toBe("pending");
    await expect(lifecycle.backfill({ agentId: "concern-embedding-b" })).resolves.toEqual({ attempted: 1, ready: 1, failed: 0 });
  });

  it("FR-37: archives fetched pages as shared files and supports cross-Bot search and bounded reads", async () => {
    const markdown = "# Vector indexes\n\nHNSW provides fast approximate search."; const changed = `${markdown}\n\nIVFFlat requires training.`;
    const summary = "HNSWによる高速な近似ベクトル検索を説明する記事。"; const changedSummary = "HNSWと、学習を必要とするIVFFlatを比較する記事。";
    const vector = Array.from({ length: 768 }, (_, index) => index === 3 ? 1 : 0);
    const embedding = new FakeEmbeddingProvider({ [summary]: vector, [changedSummary]: vector, "vector search": vector });
    const root = await mkdtemp(join(tmpdir(), "web-archive-"));
    const summarizer = { summarize: (input: { markdown: string }) => Promise.resolve(input.markdown === markdown ? summary : changedSummary) };
    const archive = new PostgresWebArchive(createRuntimeDatabase(pool), embedding, summarizer, new SequenceIdGenerator(["resource-web", "snapshot-web", "resource-repeat", "resource-changed", "snapshot-changed"]), () => new Date("2026-04-01T00:00:00Z"), "web-fake", root);
    const context = { agentId: "a", runId: "web-run", eventId: "web-event", toolCallId: "tool-1" };
    const pageRegistry = new ToolRegistry(createWebTools("http://web.local", { archive, fetcher: () => Promise.resolve(new Response(JSON.stringify({ docs: [{ url: "https://EXAMPLE.com/article?b=2&a=1#top", title: "Postgres vectors", markdown }] }), { status: 200 })) }));
    const pageResult = await pageRegistry.execute("web_page", { urls: "https://example.com/article" }, { ...context, idempotencyKey: "web-run:tool-1" }, new AbortController().signal);
    const first = (pageResult.value as { documents: { snapshotId: string; url: string; status: string; summary: string }[] }).documents;
    expect(JSON.stringify(pageResult.value)).not.toContain(markdown);
    const repeated = await archive.archivePages([{ url: "https://example.com/article?a=1&b=2", title: "Postgres vectors", markdown }], { ...context, toolCallId: "tool-2" }, new AbortController().signal);
    const latest = await archive.archivePages([{ url: "https://example.com/article?a=1&b=2", title: "Postgres vectors", markdown: changed }], { ...context, toolCallId: "tool-3" }, new AbortController().signal);
    expect(first[0]?.snapshotId).toBe(repeated[0]?.snapshotId); expect(latest[0]?.snapshotId).not.toBe(first[0]?.snapshotId);
    expect((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM web_snapshots")).rows[0]?.count).toBe("2");
    const found = await archive.search({ query: "vector search", limit: 5 }, new AbortController().signal);
    expect(found.map(({ snapshotId }) => snapshotId)).toContain(first[0]?.snapshotId);
    expect((await archive.read(first[0]?.snapshotId ?? "", 0, 20)).text.length).toBeLessThanOrEqual(20);
    expect((await archive.grep(first[0]?.snapshotId ?? "", "HNSW")).matches.length).toBeGreaterThan(0);

    const beforeList = (await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM web_snapshots")).rows[0]?.count;
    const registry = new ToolRegistry(createWebTools("http://web.local", { archive, fetcher: () => Promise.resolve(new Response(JSON.stringify({ query: "x", k: 1, results: [{ rank: 1, title: "Candidate", url: "https://example.com", snippet: "x" }] }), { status: 200 })) }));
    await registry.execute("web_list", { q: "x", k: 1 }, { agentId: "a", runId: "list-run", eventId: "list-event", toolCallId: "tool-1", idempotencyKey: "list-run:tool-1" }, new AbortController().signal);
    expect((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM web_snapshots")).rows[0]?.count).toBe(beforeList);

    await rm(root, { recursive: true, force: true });
  });

  it("FR-1, FR-7, FR-10, FR-29, FR-30, FR-43, NFR-1, NFR-3: loads a minimal Agent Core context and retrieval Tools without crossing Agent ownership", async () => {
    await pool.query("UPDATE agent_families SET base_instruction='' WHERE id='family'");
    await pool.query("UPDATE agent_states SET relationships=$2 WHERE agent_id=$1", ["a", JSON.stringify([{ subjectId: "owner", description: "Trusted" }])]);
    await pool.query("INSERT INTO memory_subjects(memory_id,subject_id) VALUES ('memory-a1','owner') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('recent-a','a','user-message',$1,'test','completed','2026-01-01'),('recent-b','b','user-message',$2,'test','completed','2026-01-01')", [JSON.stringify({ eventId: "recent-a", summary: "previous exchange", facts: ["prior context"], observedAt: fixtureInstant, actor: { id: "owner", type: "human" } }), JSON.stringify({ eventId: "recent-b", summary: "private exchange", facts: ["other agent"], observedAt: fixtureInstant, actor: { id: "other-owner", type: "human" } })]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('large-tool-result','a','tool-result',$1,'web_page','completed',now())", [JSON.stringify({ eventId: "large-tool-result", summary: "web_page result", facts: ["tool result"], observedAt: fixtureInstant, content: { markdown: "x".repeat(100_000) } })]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('attempt-event-a','a','internal',$1,'scheduler','completed',now()),('attempt-event-b','b','internal',$2,'scheduler','completed',now())", [JSON.stringify({ eventId: "attempt-event-a", summary: "recent attempt", facts: [], observedAt: new Date().toISOString(), actor: { id: "owner", type: "human" } }), JSON.stringify({ eventId: "attempt-event-b", summary: "foreign attempt", facts: [], observedAt: new Date().toISOString(), actor: { id: "other-owner", type: "human" } })]);
    await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,result,started_at,finished_at) VALUES ('attempt-run-a','a','attempt-event-a',0,$1,now(),now()),('attempt-run-b','b','attempt-event-b',0,$2,now(),now())", [JSON.stringify({ assessment: { meaning: "探索方法を変える機会になった", feeling: "少し悔しい" }, output: { desire: "探索方法を変えたい", action: { type: "respond", content: "最近、何に関心がありますか？" } } }), JSON.stringify({ assessment: { meaning: "他Agentだけの経験", feeling: "嬉しい" }, output: { action: { type: "respond", content: "private" } } })]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('failed-experience-a','a','internal',$1,'scheduler','failed',now())", [JSON.stringify({ eventId: "failed-experience-a", summary: "failed exploration", facts: [], observedAt: new Date().toISOString(), kind: "internal" })]);
    await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,result,failure_reason,started_at,finished_at) VALUES ('failed-run-a','a','failed-experience-a',0,NULL,'provider timeout',now(),now())");
    await pool.query("INSERT INTO tool_executions(id,run_id,event_id,tool_call_id,tool,input,result,error,started_at,finished_at) VALUES ('failed-tool-a','failed-run-a','failed-experience-a','call-1','web_list',$1,$2,NULL,now(),now())", [JSON.stringify({ q: "agent memory" }), JSON.stringify({ results: [] })]);
    await pool.query("INSERT INTO tool_executions(id,run_id,event_id,tool_call_id,tool,input,result,error,started_at,finished_at) VALUES ('failed-file-tool-a','failed-run-a','failed-experience-a','call-2','file_read',$1,$2,NULL,now(),now())", [JSON.stringify({ path: "notes.md", content: "raw input must not enter recent experiences".repeat(100) }), JSON.stringify({ path: "notes.md", content: "raw file must not enter recent experiences", truncated: false })]);
    const vector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const contextToolRegistry = new ToolRegistry([...createAgentContextTools(new PostgresAgentContextToolRepository(createRuntimeDatabase(pool)), createCanonicalSubjectResolver(["owner"])), ...createWebTools("http://web.local"), { name: "file_read", description: "Read", schema: z.object({}), resultPolicy: { kind: "content-read" as const, defaultRequestCharacters: 2_000, runCharacterBudget: 6_000 }, execute: () => Promise.resolve({ ok: true }) }]);
    const loader = new PostgresAgentContextLoader({
      database: createRuntimeDatabase(pool), ids: new SequenceIdGenerator(["context-run", "context-run-2", "context-run-b"]), embedding: new FakeEmbeddingProvider({ hello: vector }), tools: contextToolRegistry,
      persona: { version: 1, identity: { displayName: "Agent A" }, communication: { language: "ja", firstPerson: "僕", tone: ["明るい"], responseStyle: [], avoid: [] } },
      budget: { maxTokens: 10_000, maxMemories: 10, maxSocialContexts: 10 },
      limits: { deadlineMs: 1_000, maxSteps: 4, maxToolCalls: 0, maxHops: 4, maxAttempts: 3 }
    });
    const input = await loader.load({ id: "context-event", agentId: "a", kind: "user-message", occurredAt: fixtureInstant, payload: { text: "hello", transport: { hop: 2, expiresAt: "2026-01-02T00:00:00Z", replyTo: "discord:a" } } });
    expect(input.run).toMatchObject({ runId: "context-run", agentId: "a", transport: { hop: 2, replyTo: "discord:a" } });
    expect(input.currentSelf.agentId).toBe("a");
    expect(input.currentSelf.disposition).toBe("Careful learner");
    expect(input.currentSelf).toMatchObject({ agentId: "a", disposition: "Careful learner", selfStory: "Growing continuously", commitments: ["Care"] });
    expect(input.state).toMatchObject({ agentId: "a", concerns: [], relationships: [{ subjectId: "owner" }] });
    expect(input.persona).toMatchObject({ identity: { displayName: "Agent A" }, communication: { firstPerson: "僕" } });
    expect(input.previousAssessment).toMatchObject({ meaning: "探索方法を変える機会になった", feeling: "少し悔しい" });
    expect(typeof input.previousAssessment?.occurredAt).toBe("string");
    expect(input.previousDesire).toMatchObject({ desire: "探索方法を変えたい" });
    expect(typeof input.previousDesire?.occurredAt).toBe("string");
    expect(input.memories).toEqual([]);
    expect(input.memoryRetrievalTrace).toEqual([]);
    expect(input.recentExperiences).toHaveLength(2);
    expect(input.recentExperiences.map(({ eventId }) => eventId)).toEqual(expect.arrayContaining(["attempt-event-a", "failed-experience-a"]));
    expect(input.recentExperiences.map(({ eventId }) => eventId)).not.toContain("recent-a");
    expect(input.recentExperiences.map(({ eventId }) => eventId)).not.toContain("recent-b");
    expect(input.recentExperiences.map(({ eventId }) => eventId)).not.toContain("large-tool-result");
    expect(input.recentExperiences.map(({ eventId }) => eventId)).not.toContain("attempt-event-b");
    expect(input.recentExperiences.find(({ eventId }) => eventId === "failed-experience-a")?.steps).toEqual([
      { type: "tool", name: "web_list", input: { q: "agent memory" }, result: { resultCount: 0, results: [] }, ok: true },
      { type: "tool", name: "file_read", input: { path: "notes.md", contentSummary: { characters: 4_300, preview: "raw input must not enter recent experiencesraw input must not enter recent experiencesraw input must not enter recent experiencesraw input must not enter recent…", sha256: "e92f5dbf0154a0a4" } }, result: { path: "notes.md", contentCharacters: 42, truncated: false }, ok: true },
      { type: "failure", reason: "provider timeout" }
    ]);
    expect(JSON.stringify(input.recentExperiences)).not.toContain("raw file must not enter recent experiences");
    expect(JSON.stringify(input.recentExperiences)).not.toContain("raw input must not enter recent experiences".repeat(5));
    expect(input.runtimeConstraints.every((value) => value.length > 0)).toBe(true);
    expect(input.runtimeConstraints.join(" ")).not.toContain("Curious");
    expect(input.availableTools.map(({ name }) => name)).toEqual(["retrieval_search", "concern_list", "concern_get", "concern_history", "concern_due_focus", "concern_propose", "interaction_context_get", "memory_search", "event_search", "event_tool_results_get", "relationship_search", "self_get", "web_list", "web_page", "file_read"]);
    await pool.query("UPDATE agent_states SET relationships=$1::jsonb WHERE agent_id='a'", [JSON.stringify([{ subjectId: "user-main", description: "Trusted" }])]);
    await pool.query("UPDATE memory_subjects SET subject_id='user-main' WHERE memory_id='memory-a1' AND subject_id='owner'");
    const toolContext = { agentId: "a", runId: "context-run", eventId: "context-event", idempotencyKey: "context-tool" };
    const memorySearch = await contextToolRegistry.execute("memory_search", { query: "agent", limit: 3 }, toolContext, new AbortController().signal);
    expect(memorySearch.ok).toBe(true); expect(typeof memorySearch.value === "object" && memorySearch.value !== null && "memories" in memorySearch.value && Array.isArray(memorySearch.value.memories)).toBe(true);
    await expect(contextToolRegistry.execute("relationship_search", {}, { ...toolContext, idempotencyKey: "relationship-tool" }, new AbortController().signal)).resolves.toMatchObject({ value: { relationships: [{ description: "Trusted" }] } });
    const userContext = await contextToolRegistry.execute("interaction_context_get", {}, { ...toolContext, idempotencyKey: "user-context-tool" }, new AbortController().signal);
    expect(userContext.ok).toBe(true);
    if (!userContext.ok || typeof userContext.value !== "object" || userContext.value === null) throw new Error("Expected user context");
    const userContextValue = userContext.value as Record<string, unknown>;
    expect(userContextValue.subjectId).toBeUndefined();
    expect(typeof userContextValue.factCount).toBe("number");
    expect(Array.isArray(userContextValue.knownFacts) ? userContextValue.knownFacts.length : 99).toBeLessThanOrEqual(5);
    expect(userContextValue.relationshipSummary).toBe("Trusted");
    expect(userContextValue.recentlyAskedTopics).toEqual(["最近、何に関心がありますか？"]);
    await expect(contextToolRegistry.execute("self_get", { fields: ["disposition"] }, { ...toolContext, idempotencyKey: "self-tool" }, new AbortController().signal)).resolves.toMatchObject({ value: { disposition: "Careful learner" } });
    await expect(contextToolRegistry.execute("concern_propose", { operation: "create", description: "検証方法を確認する", whyItMatters: "信頼性を判断するため" }, { ...toolContext, idempotencyKey: "proposal-tool" }, new AbortController().signal)).resolves.toMatchObject({ value: { queued: true } });
    const allowed = await loader.load({ id: "context-event-2", agentId: "a", kind: "user-message", occurredAt: fixtureInstant, payload: { text: "hello" } });
    expect(allowed.availableTools.map(({ name }) => name)).toEqual(input.availableTools.map(({ name }) => name));
    const other = await loader.load({ id: "context-event-b", agentId: "b", kind: "user-message", occurredAt: fixtureInstant, payload: { text: "hello" } });
    expect(other.currentSelf.disposition).toBe("Careful learner");
    expect(other.previousDesire).toBeUndefined();
    const saved = await getConcerns("a");
    await pool.query("DELETE FROM concerns WHERE agent_id='a'");
    await pool.query("INSERT INTO concerns(id,agent_id,description,why_it_matters,status) VALUES ('invalid-concern','a','不正なConcern','検証用','invalid')");
    try {
      await expect(loader.load({ id: "invalid-state-event", agentId: "a", kind: "internal", occurredAt: fixtureInstant, payload: {} })).rejects.toThrow("invalid_value");
    } finally { await setConcerns("a", saved); }

  });

  it("NFR-10: holds one process lock per Agent and drains loops during shutdown", async () => {
    const blocked = (signal: AbortSignal): Promise<void> => new Promise((resolve) => { signal.addEventListener("abort", () => { resolve(); }, { once: true }); });
    let drained = 0;
    const createHost = (lifecycle: ProcessLifecycle): BotHost => new BotHost({
      pool, agentId: "a", lifecycle, capabilityCheck: () => Promise.resolve(), retryDelayMs: 1,
      runtime: { start: blocked, drain: () => { drained += 1; return Promise.resolve(); } },
      scheduler: { tick: () => Promise.resolve(0) }, outbox: { dispatch: () => Promise.resolve(0) },
      discord: { startInbound: blocked, startOutbound: blocked }, schedulerIntervalMs: 10_000, outboxIntervalMs: 10_000
    });
    const firstLifecycle = new ProcessLifecycle(); const first = createHost(firstLifecycle);
    await first.start(); expect(firstLifecycle.state).toBe("ready");
    const secondLifecycle = new ProcessLifecycle(); const second = createHost(secondLifecycle);
    await expect(second.start()).rejects.toMatchObject({ code: "CONFLICT" });
    expect(secondLifecycle.state).toBe("stopped");
    await first.stop();
    expect(firstLifecycle.state).toBe("stopped"); expect(drained).toBe(1);
    const restartedLifecycle = new ProcessLifecycle(); const restarted = createHost(restartedLifecycle);
    await restarted.start(); await restarted.stop();
    expect(restartedLifecycle.state).toBe("stopped");
  });

  it("FR-40, NFR-6: claims a due Scheduled Task once and records its execution Event", async () => {
    await pool.query("INSERT INTO scheduled_tasks(id,agent_id,execute_at,instruction,status,idempotency_key,source_event_id,source_run_id) VALUES ('task-due','a','2026-01-01','結果を知らせる','scheduled','task-key','source-event','source-run')");
    const first = new PostgresScheduleRepository(createRuntimeDatabase(pool)); const second = new PostgresScheduleRepository(createRuntimeDatabase(pool));
    const claims = (await Promise.all([first.claimDue(new Date("2026-01-02T00:00:00Z"), 10), second.claimDue(new Date("2026-01-02T00:00:00Z"), 10)])).flat().filter(({ id }) => id === "task-due");
    expect(claims).toEqual([{ id: "task-due", agentId: "a", kind: "scheduled-task", reason: "Scheduled Taskの期限到来", instruction: "結果を知らせる" }]);
    const task = claims[0]; if (task === undefined) throw new Error("Scheduled Task was not claimed");
    await first.complete(task, null, "execution-event");
    expect((await pool.query("SELECT status,attempt,execution_event_id FROM scheduled_tasks WHERE id='task-due'")).rows[0]).toMatchObject({ status: "completed", attempt: 1, execution_event_id: "execution-event" });
  });

  it("FR-40: updates only an owned pending Scheduled Task", async () => {
    await pool.query("INSERT INTO scheduled_tasks(id,agent_id,execute_at,instruction,status,idempotency_key,source_event_id,source_run_id) VALUES ('task-update-a','a','2026-01-02','元の指示','scheduled','update-key-a','source-event','source-run'),('task-update-b','b','2026-01-02','他Agentの指示','scheduled','update-key-b','source-event','source-run')");
    const registry = new ToolRegistry(createScheduledTaskTools(new PostgresScheduledTaskToolRepository(createRuntimeDatabase(pool)), new SequenceIdGenerator([]), () => new Date("2026-01-01T00:00:00Z")));
    const signal = new AbortController().signal;
    await expect(registry.execute("scheduled_task_update", { taskId: "task-update-a", executeAt: "2026-01-03T00:00:00Z", instruction: "更新後の指示" }, { agentId: "a", runId: "update-run", eventId: "update-event", idempotencyKey: "update-call" }, signal)).resolves.toMatchObject({ ok: true, value: { id: "task-update-a", instruction: "更新後の指示", status: "scheduled" } });
    await expect(registry.execute("scheduled_task_update", { taskId: "task-update-b", instruction: "越境更新" }, { agentId: "a", runId: "update-run", eventId: "update-event", idempotencyKey: "cross-owner" }, signal)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await pool.query<{ instruction: string }>("SELECT instruction FROM scheduled_tasks WHERE id='task-update-b'")).rows[0]?.instruction).toBe("他Agentの指示");
  });

  it("FR-40, NFR-17: audits the source Event and explicit reason when creating a Scheduled Task", async () => {
    const registry = new ToolRegistry(createScheduledTaskTools(new PostgresScheduledTaskToolRepository(createRuntimeDatabase(pool)), new SequenceIdGenerator(["task-created-audit"]), () => new Date("2026-01-01T00:00:00Z")));
    await expect(registry.execute("schedule_task", { executeAt: "2026-01-03T00:00:00Z", instruction: "観測結果を比較する", reason: "48時間後の変化そのものを観測したい" }, { agentId: "a", runId: "task-source-run", eventId: "task-source-event", idempotencyKey: "task-create-audit" }, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { id: "task-created-audit" } });
    expect((await pool.query<{ source_event_id: string; source_run_id: string; reason: string }>("SELECT source_event_id,source_run_id,reason FROM scheduled_tasks WHERE id='task-created-audit'")).rows).toEqual([{ source_event_id: "task-source-event", source_run_id: "task-source-run", reason: "48時間後の変化そのものを観測したい" }]);
  });

  it("NFR-11: never claims removed, legacy, or unknown autonomous schedule kinds", async () => {
    await pool.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ('legacy-drive','a','autonomy-review','legacy','2026-01-01'),('external-change-due','a','external-change','removed','2026-01-01'),('idle-due','a','idle','idle','2026-01-01')");
    const repository = new PostgresScheduleRepository(createRuntimeDatabase(pool));
    const claims = await repository.claimDue(new Date("2026-01-02T00:00:00Z"), 10);
    expect(claims.map(({ id }) => id)).toContain("idle-due");
    expect(claims.map(({ id }) => id)).not.toContain("legacy-drive");
    expect(claims.map(({ id }) => id)).not.toContain("external-change-due");
    expect((await pool.query<{ lease_until: Date | null }>("SELECT lease_until FROM autonomous_schedules WHERE id='legacy-drive'")).rows[0]?.lease_until).toBeNull();
    expect((await pool.query<{ lease_until: Date | null }>("SELECT lease_until FROM autonomous_schedules WHERE id='external-change-due'")).rows[0]?.lease_until).toBeNull();
  });

  it("FR-24, NFR-6: removes legacy concern-due and external-change schedules only when migration is applied", async () => {
    const agentId = "legacy-signal-migration-agent";
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ($1,'family','Legacy Signal Migration','Calm')", [agentId]);
    await pool.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ('legacy-concern-due',$1,'concern-due','old concern','2026-01-01'),('legacy-external-change',$1,'external-change','removed event','2026-01-01')", [agentId]);
    await expect(migrateConcernReevaluationSignals(database.admin, { apply: false, agentId })).resolves.toEqual({ apply: false, agentId, concernDueSchedulesRemoved: 1, externalChangeSchedulesRemoved: 1 });
    expect((await pool.query("SELECT 1 FROM autonomous_schedules WHERE agent_id=$1", [agentId])).rowCount).toBe(2);
    await expect(migrateConcernReevaluationSignals(database.admin, { apply: true, agentId })).resolves.toEqual({ apply: true, agentId, concernDueSchedulesRemoved: 1, externalChangeSchedulesRemoved: 1 });
    expect((await pool.query("SELECT 1 FROM autonomous_schedules WHERE agent_id=$1", [agentId])).rowCount).toBe(0);
  });

  it("FR-24, NFR-6: coalesces and claims one pending Concern signal, retains it on retry, and does not reschedule after completion", async () => {
    await pool.query("INSERT INTO concern_reevaluation_signals(agent_id,next_due_at,reason) VALUES ('a','2026-01-01','new memories')");
    await pool.query("INSERT INTO concern_reevaluation_signal_sources(agent_id,source_kind,source_id) VALUES ('a','memory','memory-1'),('a','memory','memory-2')");
    const repository = new PostgresScheduleRepository(createRuntimeDatabase(pool), 60_000, "a", 1_000);
    const claimed = (await repository.claimDue(new Date("2026-01-02T00:00:00Z"), 10)).find(({ kind }) => kind === "concern-due");
    expect(claimed).toMatchObject({ id: "concern-due:a", agentId: "a", kind: "concern-due", reason: "new memories" });
    if (claimed === undefined || claimed.kind !== "concern-due") throw new Error("Signal was not claimed");
    await repository.release(claimed);
    expect((await pool.query<{ lease_until: Date | null }>("SELECT lease_until FROM concern_reevaluation_signals WHERE agent_id='a'")).rows[0]?.lease_until).toBeNull();
    await pool.query("UPDATE concern_reevaluation_signals SET next_due_at='2026-01-01' WHERE agent_id='a'");
    const restarted = new PostgresScheduleRepository(createRuntimeDatabase(pool), 60_000, "a", 1_000);
    const retried = (await restarted.claimDue(new Date("2026-01-02T00:00:00Z"), 10)).find(({ kind }) => kind === "concern-due");
    if (retried === undefined || retried.kind !== "concern-due") throw new Error("Signal was not reclaimed");
    await restarted.complete(retried, null);
    expect((await pool.query("SELECT 1 FROM concern_reevaluation_signals WHERE agent_id='a'")).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM autonomous_schedules WHERE agent_id='a' AND kind='concern-due'")).rowCount).toBe(0);
  });

  it("FR-26, FR-28: reschedules idle without persisted exploration state", async () => {
    await pool.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ('idle-mode:b','b','idle','explore','2026-01-01')");
    const repository = new PostgresScheduleRepository(createRuntimeDatabase(pool), 60_000, "b");
    const first = (await repository.claimDue(new Date("2026-01-02T00:00:00Z"), 10)).find(({ id }) => id === "idle-mode:b");
    expect(first).toMatchObject({ kind: "idle" });
    if (first === undefined) throw new Error("Idle schedule was not claimed");
    await repository.release(first);
    await pool.query("UPDATE autonomous_schedules SET next_due_at='2026-01-01' WHERE id='idle-mode:b'");
    const second = (await repository.claimDue(new Date("2026-01-02T00:00:00Z"), 10)).find(({ id }) => id === "idle-mode:b");
    expect(second).toMatchObject({ kind: "idle" });
    if (second === undefined) throw new Error("Retried idle schedule was not claimed");
    await repository.complete(second, new Date("2026-01-03T00:00:00Z"));
    expect((await pool.query<{ next_due_at: Date }>("SELECT next_due_at FROM autonomous_schedules WHERE id='idle-mode:b'")).rows[0]?.next_due_at.toISOString()).toBe("2026-01-03T00:00:00.000Z");
  });

  it("FR-42: caps Reflection backoff at 24 hours", async () => {
    await pool.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ('reflection:cap','a','reflection','maintenance',now())");
    for (let index = 0; index < 9; index += 1) {
      await pool.query("INSERT INTO reflection_runs(id,agent_id,input_state_version,status,input,failure_reason) VALUES ($1,'a',0,'failed','{}','invalid output')", [`reflection-cap-${String(index)}`]);
    }
    const repository = new PostgresScheduleRepository(createRuntimeDatabase(pool), 60_000, "a", 400_000);
    await repository.release({ id: "reflection:cap", agentId: "a", kind: "reflection", reason: "maintenance" });
    const row = (await pool.query<{ delay_ms: number }>("SELECT round(extract(epoch FROM (next_due_at-updated_at))*1000)::int AS delay_ms FROM autonomous_schedules WHERE id='reflection:cap'")).rows[0];
    // Retry delay is deliberately disabled while autonomous-flow debugging is enabled.
    expect(row?.delay_ms).toBe(0);
    await pool.query("DELETE FROM reflection_runs WHERE id LIKE 'reflection-cap-%'");
    await pool.query("DELETE FROM autonomous_schedules WHERE id='reflection:cap'");
  });

  it("FR-42: backs off repeated Reflection failures instead of retrying at a fixed interval", async () => {
    await pool.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ('reflection:a','a','reflection','maintenance',now())");
    for (const id of ["reflection-failed-1", "reflection-failed-2", "reflection-failed-3"]) {
      await pool.query("INSERT INTO reflection_runs(id,agent_id,input_state_version,status,input,failure_reason) VALUES ($1,'a',0,'failed','{}','invalid output')", [id]);
    }
    const repository = new PostgresScheduleRepository(createRuntimeDatabase(pool), 60_000, "a", 1_000);
    await repository.release({ id: "reflection:a", agentId: "a", kind: "reflection", reason: "maintenance" });
    const row = (await pool.query<{ delay_ms: number }>("SELECT round(extract(epoch FROM (next_due_at-updated_at))*1000)::int AS delay_ms FROM autonomous_schedules WHERE id='reflection:a'")).rows[0];
    expect(row?.delay_ms).toBe(0);
  });

  it("FR-42, FR-60: increases backoff when one retryable Reflection Session fails repeatedly", async () => {
    await pool.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ('reflection:retry-one','b','reflection','maintenance',now())");
    await pool.query("INSERT INTO reflection_runs(id,agent_id,input_state_version,status,input,failure_reason) VALUES ('reflection-retry-one','b',0,'pending','{}','Reflection has retryable target failures')");
    const repository = new PostgresScheduleRepository(createRuntimeDatabase(pool), 60_000, "b", 1_000);
    const target = { id: "reflection:retry-one", agentId: "b", kind: "reflection" as const, reason: "maintenance" };
    await repository.release(target);
    let row = (await pool.query<{ delay_ms: number }>("SELECT round(extract(epoch FROM (next_due_at-updated_at))*1000)::int AS delay_ms FROM autonomous_schedules WHERE id='reflection:retry-one'" )).rows[0];
    expect(row?.delay_ms).toBe(0);
    await repository.release(target);
    row = (await pool.query<{ delay_ms: number }>("SELECT round(extract(epoch FROM (next_due_at-updated_at))*1000)::int AS delay_ms FROM autonomous_schedules WHERE id='reflection:retry-one'" )).rows[0];
    expect(row?.delay_ms).toBe(0);
    expect((await pool.query<{ retry_count: number }>("SELECT retry_count FROM reflection_runs WHERE id='reflection-retry-one'")).rows[0]?.retry_count).toBe(2);
    await pool.query("DELETE FROM reflection_runs WHERE id='reflection-retry-one'");
    await pool.query("DELETE FROM autonomous_schedules WHERE id='reflection:retry-one'");
  });

  it("NFR-10: shares correlation-loop and rate limits across Runtime instances", async () => {
    const first = new PostgresRuntimePersistence(createRuntimeDatabase(pool), () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    const second = new PostgresRuntimePersistence(createRuntimeDatabase(pool), () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    const event = { id: "policy-event-1", agentId: "a", kind: "external" as const, occurredAt: fixtureInstant, payload: {}, correlationId: "shared-correlation" };
    await expect(first.authorizeInbound(event, "policy-message-1", 10)).resolves.toBeUndefined();
    await expect(second.authorizeInbound({ ...event, id: "policy-event-2" }, "policy-message-2", 10)).rejects.toMatchObject({ code: "VALIDATION" });
    const conversationEvent = { ...event, id: "policy-conversation-event-1", kind: "message-received" as const, correlationId: "conversation-correlation" };
    await expect(first.authorizeInbound(conversationEvent, "policy-conversation-message-1", 10)).resolves.toBeUndefined();
    await expect(second.authorizeInbound({ ...conversationEvent, id: "policy-conversation-event-2" }, "policy-conversation-message-2", 10)).resolves.toBeUndefined();
    await expect(second.authorizeInbound({ ...event, id: "policy-event-3", correlationId: "rate-correlation-1" }, "policy-message-3", 1)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("NFR-7, NFR-8: expires only old runtime correlation and rate-window state", async () => {
    await pool.query("INSERT INTO runtime_correlations(agent_id,correlation_id,message_id,created_at) VALUES ('a','expired-correlation','old-message','2026-01-01T00:00:00Z'),('a','live-correlation','new-message','2026-11-14T00:00:00Z')");
    await pool.query("INSERT INTO runtime_rate_windows(agent_id,window_start,event_count) VALUES ('a','2026-01-01T00:00:00Z',1),('a','2026-11-14T00:00:00Z',1)");
    const persistence = new PostgresRuntimePersistence(createRuntimeDatabase(pool), () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    await expect(persistence.cleanupRuntimeState(new Date("2026-11-01T00:00:00Z"), new Date("2026-11-01T00:00:00Z"))).resolves.toEqual({ correlations: 1, rateWindows: 1 });
    expect((await pool.query<{ correlation_id: string }>("SELECT correlation_id FROM runtime_correlations WHERE correlation_id IN ('expired-correlation','live-correlation') ORDER BY correlation_id")).rows).toEqual([{ correlation_id: "live-correlation" }]);
    expect((await pool.query<{ window_start: Date }>("SELECT window_start FROM runtime_rate_windows WHERE window_start IN ('2026-01-01T00:00:00Z','2026-11-14T00:00:00Z')")).rows.map(({ window_start }) => window_start.toISOString())).toEqual(["2026-11-14T00:00:00.000Z"]);
  });

  it("NFR-1, NFR-9: loads only the owning Agent's pending Outbox records", async () => {
    const envelopeA = messageFixture({ id: "outbox-agent-a", destination: "discord:a" });
    const envelopeB = messageFixture({ id: "outbox-agent-b", destination: "discord:b" });
    await pool.query("INSERT INTO outbox_messages(id,agent_id,envelope) VALUES ($1,'a',$2),($3,'b',$4)", [envelopeA.id, JSON.stringify(envelopeA), envelopeB.id, JSON.stringify(envelopeB)]);
    const forA = new PostgresRuntimePersistence(createRuntimeDatabase(pool), () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant), "a");
    const forB = new PostgresRuntimePersistence(createRuntimeDatabase(pool), () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant), "b");
    const pendingA = await forA.pendingOutbox(100);
    const pendingB = await forB.pendingOutbox(100);
    expect(pendingA.map(({ envelope }) => envelope.id)).toContain(envelopeA.id);
    expect(pendingA.map(({ envelope }) => envelope.id)).not.toContain(envelopeB.id);
    expect(pendingB.map(({ envelope }) => envelope.id)).toContain(envelopeB.id);
    expect(pendingB.map(({ envelope }) => envelope.id)).not.toContain(envelopeA.id);
  });

  it("FR-25, NFR-7: materializes normal Core proposals, Concern Activity, and Tool execution records with Runtime-owned metadata", async () => {
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,evidence_event_ids) VALUES ('proposal-evidence','a','self-related','Repeated follow-through','Relevant',now(),'[]')");
    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const input = agentCoreInputFixture();
    input.run = { runId: "runtime-run", eventId: "runtime-event", agentId: "a", occurredAt: fixtureInstant };
    input.observation = { ...input.observation, actor: { id: "user-42", type: "human" } };
    input.currentSelf = { ...input.currentSelf, agentId: "a", version };
    input.state = { ...input.state, agentId: "a", concerns: [{ id: "runtime-concern", description: "実行時に調べるConcern", whyItMatters: "結果を判断へ使うため", status: "active" }] };
    input.memories = [{ id: "proposal-evidence", agentId: "a", kind: "self-related", content: "Repeated follow-through", occurredAt: fixtureInstant, createdAt: fixtureInstant, relatedSubjectIds: [], importance: "Relevant", retrievalPriority: "normal", evidenceEventIds: [] }];
    input.availableTools = [{ name: "concern_get", description: "Concern", inputSchema: {} }, { name: "concern_history", description: "Concern history", inputSchema: {} }, { name: "lookup", description: "Lookup", inputSchema: {} }];
    input.memoryRetrievalTrace = [{ memoryId: "proposal-evidence", finalRank: 1, matchedBy: ["subject", "recency"], kind: "self-related", selected: true }];
    const persistence = new PostgresRuntimePersistence(createRuntimeDatabase(pool), () => Promise.resolve(input), new SequenceIdGenerator(["tool-record", "integration-job", "motive-new", "memory-new", "state-change-mood", "state-change-social", "state-change-motive"]), () => new Date(fixtureInstant));
    const message = messageFixture({ id: "runtime-message", destination: "agent:a" });
    const event = { id: "runtime-event", agentId: "a", kind: "user-message" as const, occurredAt: fixtureInstant, payload: { text: "hello" }, causationId: "incoming-message", correlationId: "conversation-1" };
    const result = {
      output: { desire: "respond to this event", action: { type: "respond" as const, content: "Hello" } },
      toolExecutions: [
        { callId: "tool-focus", runId: "runtime-run", eventId: "runtime-event", name: "concern_get", input: { concernId: "runtime-concern" }, ok: true, result: { concernId: "runtime-concern" }, startedAt: fixtureInstant, finishedAt: fixtureInstant },
        { callId: "tool-progress", runId: "runtime-run", eventId: "runtime-event", name: "concern_history", input: { concernId: "runtime-concern" }, ok: true, result: { concernId: "runtime-concern", evidenceMemories: [] }, startedAt: fixtureInstant, finishedAt: fixtureInstant },
        { callId: "tool-1", runId: "runtime-run", eventId: "runtime-event", name: "lookup", input: { q: "x" }, ok: true, result: { answer: 1 }, startedAt: fixtureInstant, finishedAt: fixtureInstant }
      ]
    };
    await expect(persistence.commit(message, event, input, result, { state: input.state, changes: [], concernActivities: [{ concernId: "runtime-concern", kind: "created", eventId: "runtime-event" }] }, [])).resolves.toBe("committed");
    expect((await pool.query<{ event_id: string; tool: string }>("SELECT r.event_id,t.tool FROM tool_executions t JOIN agent_runs r ON r.id=t.run_id WHERE t.id='tool-record'")).rows[0]).toEqual({ event_id: "runtime-event", tool: "concern_get" });
    expect((await pool.query<{ causation_id: string; correlation_id: string }>("SELECT causation_id,correlation_id FROM events WHERE id='runtime-event'")).rows[0]).toEqual({ causation_id: "incoming-message", correlation_id: "conversation-1" });
    expect((await pool.query("SELECT id FROM events WHERE id LIKE 'runtime-event:tool-result:%'")).rowCount).toBe(0);
    expect((await pool.query<{ event_id: string | null; result_event_id: string | null }>("SELECT event_id,result_event_id FROM tool_executions WHERE id='tool-record'")).rows[0]).toEqual({ event_id: null, result_event_id: null });
    expect((await pool.query<{ result: { memoryRetrievalTrace?: unknown[] } }>("SELECT result FROM agent_runs WHERE id='runtime-run'")).rows[0]?.result.memoryRetrievalTrace).toEqual(input.memoryRetrievalTrace);
    expect((await pool.query<{ concern_id: string; kind: string; event_id: string; run_id: string }>("SELECT ca.concern_id,ca.kind,ca.event_id,ca.run_id FROM concern_activities ca JOIN concerns c ON c.id=ca.concern_id WHERE c.agent_id='a' AND ca.concern_id='runtime-concern' ORDER BY ca.kind")).rows).toEqual([
      { concern_id: "runtime-concern", kind: "created", event_id: "runtime-event", run_id: "runtime-run" },
      { concern_id: "runtime-concern", kind: "focused", event_id: "runtime-event", run_id: "runtime-run" },
      { concern_id: "runtime-concern", kind: "focused", event_id: "runtime-event", run_id: "runtime-run" },
      { concern_id: "runtime-concern", kind: "progressed", event_id: "runtime-event", run_id: "runtime-run" }
    ]);
    const inputSnapshot = (await pool.query<{ input_snapshot: { run: { runId: string }; observation: { summary: string }; currentSelf: { version: number }; availableTools: { name: string; inputSchema?: unknown }[]; memories: { id: string }[] } }>("SELECT input_snapshot FROM agent_runs WHERE id='runtime-run'")).rows[0]?.input_snapshot;
    expect(inputSnapshot).toMatchObject({ run: { runId: "runtime-run" }, observation: { summary: input.observation.summary }, currentSelf: { version }, memories: [{ id: "proposal-evidence" }], availableTools: [{ name: "concern_get", inputSchema: {} }, { name: "concern_history", inputSchema: {} }, { name: "lookup", inputSchema: {} }] });
    expect((await pool.query<{ subject_id: string }>("SELECT subject_id FROM memory_subjects WHERE memory_id='integration-job'")).rows).toEqual([]);
  });

  it("FR-69, NFR-7, NFR-8: commits a derived Concern and its immutable lineage audit together", async () => {
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,evidence_event_ids) VALUES ('lineage-signal','a','episodic','比較条件が異なるという新しい経験','派生の根拠',now(),'[]') ON CONFLICT (id) DO NOTHING");
    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const input = agentCoreInputFixture();
    input.run = { runId: "lineage-run", eventId: "lineage-event", agentId: "a", occurredAt: fixtureInstant };
    input.currentSelf = { ...input.currentSelf, agentId: "a", version };
    input.state = { ...input.state, agentId: "a", concerns: [
      { id: "lineage-parent", description: "記憶の変質を確かめたい", whyItMatters: "比較の基準が気になる", status: "active" },
      { id: "lineage-child", description: "比較条件ごとの差を確かめたい", whyItMatters: "別の持続的な関心として残った", status: "active" }
    ] };
    const persistence = new PostgresRuntimePersistence(createRuntimeDatabase(pool), () => Promise.resolve(input), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    const event = { id: "lineage-event", agentId: "a", kind: "internal" as const, occurredAt: fixtureInstant, payload: { reason: "concern-due" } };
    await expect(persistence.commit(messageFixture({ id: "lineage-message", destination: "agent:a" }), event, input, { output: { desire: "派生を残す", action: { type: "no-external-action", reason: "監査だけを確定する" } }, toolExecutions: [] }, {
      state: input.state,
      changes: [],
      concernActivities: [{ concernId: "lineage-child", kind: "derived", eventId: "lineage-event", sourceConcernId: "lineage-parent", reason: "新しい経験が比較条件への独立した関心を生んだ", evidenceMemoryIds: ["lineage-signal"] }]
    }, [])).resolves.toBe("committed");
    expect((await pool.query<{ concern_id: string; source_concern_id: string; reason: string; evidence_memory_ids: string[]; event_id: string }>("SELECT concern_id,source_concern_id,reason,evidence_memory_ids,event_id FROM concern_activities WHERE concern_id='lineage-child' AND kind='derived'")).rows).toEqual([{
      concern_id: "lineage-child", source_concern_id: "lineage-parent", reason: "新しい経験が比較条件への独立した関心を生んだ", evidence_memory_ids: ["lineage-signal"], event_id: "lineage-event"
    }]);
    expect((await getConcerns("a")).filter(({ id }) => id.startsWith("lineage-")).map(({ id, status }) => ({ id, status }))).toEqual([
      { id: "lineage-child", status: "active" },
      { id: "lineage-parent", status: "active" }
    ]);
    // Keep fixture cleanup compatible with later tests that deliberately use
    // physical deletion to seed their isolated Concern sets.
    await pool.query("DELETE FROM concern_activities WHERE concern_id IN ('lineage-parent','lineage-child') OR source_concern_id IN ('lineage-parent','lineage-child')");
    await pool.query("DELETE FROM concerns WHERE id IN ('lineage-parent','lineage-child')");
    await pool.query("DELETE FROM memories WHERE id='lineage-signal'");
  });

  it("NFR-7: restores pending Integration traces from the canonical Run snapshot", async () => {
    const core = agentCoreInputFixture();
    const makeInput = (eventId: string, runId: string) => ({ ...core, run: { ...core.run, eventId, runId, agentId: "a" }, observation: { ...core.observation, eventId }, currentSelf: { ...core.currentSelf, agentId: "a" }, state: { ...core.state, agentId: "a" } });
    const current = makeInput("integration-current-event", "integration-current-run");
    const legacy = makeInput("integration-legacy-event", "integration-legacy-run");
    legacy.recentExperiences = [{ eventId: "legacy-prior-event", runId: "legacy-prior-run", agentId: "a", occurredAt: fixtureInstant, eventKind: "message-received", observation: { summary: "旧peer形式で応答した", facts: [] }, steps: [{ type: "action", action: { type: "respond", content: "旧形式の返答", peer: { name: "aka", content: "旧形式の返答" } } as never }], progressChanged: false }];
    for (const value of [current, legacy]) {
      await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ($1,'a','user-message',$2,'test','completed',$3)", [value.run.eventId, JSON.stringify(value.observation), fixtureInstant]);
      await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,input_snapshot,result,started_at,finished_at) VALUES ($1,'a',$2,0,$3,$4,$5,$5)", [value.run.runId, value.run.eventId, JSON.stringify(value), JSON.stringify({ output: { desire: "返す", action: { type: "respond", content: "了解" } }, toolExecutions: [] }), fixtureInstant]);
    }
    const toolExecutions = [{ callId: "stored-tool", runId: current.run.runId, eventId: current.run.eventId, name: "memory_search", input: { query: "予定" }, ok: true, result: { memories: [] }, startedAt: fixtureInstant, finishedAt: fixtureInstant }];
    await pool.query("UPDATE agent_runs SET result=$2 WHERE id=$1", [current.run.runId, JSON.stringify({ output: { desire: "覚えておきたい", action: { type: "respond", content: "了解" } }, toolExecutions })]);
    const legacyTools = toolExecutions.map((item) => ({ ...item, runId: legacy.run.runId, eventId: legacy.run.eventId }));
    await pool.query("UPDATE agent_runs SET result=$2 WHERE id=$1", [legacy.run.runId, JSON.stringify({ output: { desire: "覚えておきたい", action: { type: "respond", content: "了解" } }, toolExecutions: legacyTools })]);
    await pool.query("INSERT INTO experience_integrations(id,source_run_id,status) VALUES ('integration-current',$1,'failed'),('integration-legacy',$2,'failed')", [current.run.runId, legacy.run.runId]);
    const pending = await new PostgresExperienceIntegrationRepository(createRuntimeDatabase(pool), new SequenceIdGenerator([]), () => new Date(fixtureInstant)).pending("a");
    expect(pending.find(({ integrationId }) => integrationId === "integration-current")?.result.toolExecutions).toEqual(toolExecutions);
    expect(pending.find(({ integrationId }) => integrationId === "integration-legacy")?.result.toolExecutions).toEqual(legacyTools);
    expect(pending.find(({ integrationId }) => integrationId === "integration-legacy")?.input.recentExperiences[0]?.steps[0]).toEqual({ type: "action", action: { type: "respond", content: "旧形式の返答" } });
  });

  it("FR-82, FR-78: persists an Event Experience without a long-term Memory and exposes it to Reflection", async () => {
    const agentId = "experience-projection-agent";
    const eventId = "experience-projection-event";
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ($1,'family','Experience Projection Agent','Careful')", [agentId]);
    await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,relationships,mood) VALUES ($1,'Careful','Story','[]','[]','Calm')", [agentId]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ($1,$2,'internal',$3,'test','completed',$4)", [eventId, agentId, { summary: "展示の予定を確かめた" }, fixtureInstant]);
    const core = agentCoreInputFixture();
    const input = { ...core, run: { ...core.run, agentId, eventId, runId: "experience-projection-run", occurredAt: fixtureInstant }, observation: { ...core.observation, eventId }, currentSelf: { ...core.currentSelf, agentId }, state: { ...core.state, agentId } };
    await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,input_snapshot,result,started_at,finished_at) VALUES ('experience-projection-run',$1,$2,0,$3,$4,$5,$5)", [agentId, eventId, input, { output: { desire: "予定を整理したい", action: { type: "no-external-action", reason: "maintenance" } }, toolExecutions: [] }, fixtureInstant]);
    const request = { integrationId: "experience-projection-integration", agentId, sourceEvent: { id: eventId, agentId, kind: "internal" as const, occurredAt: fixtureInstant, payload: { targetKind: "idle" } }, sourceRunId: input.run.runId, input, result: { output: { desire: "予定を整理したい", action: { type: "no-external-action" as const, reason: "maintenance" } }, toolExecutions: [] } };
    const repository = new PostgresExperienceIntegrationRepository(createRuntimeDatabase(pool), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    await repository.begin(request);
    await repository.apply(request, { experience: { summary: "展示の予定を確かめた", facts: ["展示の予定を確認した"] }, memories: [] });
    expect((await pool.query("SELECT 1 FROM event_experiences WHERE event_id=$1", [eventId])).rowCount).toBe(1);
    const projection = (await pool.query<{ content_hash: string | null; content: string | null; agent_id: string | null }>("SELECT content_hash,content,agent_id FROM event_projections WHERE event_id=$1", [eventId])).rows[0];
    expect(projection?.content_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(projection).toMatchObject({ content: null, agent_id: null });
    expect((await pool.query("SELECT 1 FROM concern_reevaluation_signal_sources WHERE agent_id=$1", [agentId])).rowCount).toBe(0);
    await expect((new PostgresReflectionRepository(createRuntimeDatabase(pool), new SequenceIdGenerator([]), () => new Date("2026-01-02T00:00:00Z"))).load("experience-projection-reflection", agentId)).resolves.toMatchObject({ events: [expect.objectContaining({ id: eventId, summary: "展示の予定を確かめた" })] });
  });

  it("NFR-8: rolls back Event Experience and Projection together when Projection persistence fails", async () => {
    const agentId = "experience-atomic-agent";
    const eventId = "experience-atomic-event";
    const runId = "experience-atomic-run";
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ($1,'family','Atomic Agent','Careful')", [agentId]);
    await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,relationships,mood) VALUES ($1,'Careful','Story','[]','[]','Calm')", [agentId]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ($1,$2,'internal',$3,'test','completed',$4)", [eventId, agentId, { summary: "atomic experience" }, fixtureInstant]);
    const core = agentCoreInputFixture();
    const input = { ...core, run: { ...core.run, agentId, eventId, runId, occurredAt: fixtureInstant }, observation: { ...core.observation, eventId }, currentSelf: { ...core.currentSelf, agentId }, state: { ...core.state, agentId } };
    const result = { output: { desire: "整理する", action: { type: "no-external-action" as const, reason: "maintenance" } }, toolExecutions: [] };
    await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,input_snapshot,result,started_at,finished_at) VALUES ($1,$2,$3,0,$4,$5,$6,$6)", [runId, agentId, eventId, input, result, fixtureInstant]);
    const request = { integrationId: "experience-atomic-integration", agentId, sourceEvent: { id: eventId, agentId, kind: "internal" as const, occurredAt: fixtureInstant, payload: {} }, sourceRunId: runId, input, result };
    const repository = new PostgresExperienceIntegrationRepository(createRuntimeDatabase(pool), new SequenceIdGenerator([]), () => new Date(fixtureInstant), { prepareMemory: () => Promise.resolve({ status: "ready", vector: [1, 0], model: "invalid-dimension", dimension: 2 }) });
    await repository.begin(request);
    await expect(repository.apply(request, { experience: { summary: "atomic experience", facts: ["all or nothing"] }, memories: [] })).rejects.toThrow();
    expect((await pool.query("SELECT 1 FROM event_experiences WHERE event_id=$1", [eventId])).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM event_projections WHERE event_id=$1", [eventId])).rowCount).toBe(0);
    expect((await pool.query<{ status: string }>("SELECT status FROM experience_integrations WHERE id=$1", [request.integrationId])).rows[0]).toEqual({ status: "pending" });
  });

  it("FR-78, NFR-7: backfills searchable subjects and content hashes from legacy Event Experience rows", async () => {
    const agentId = "normalized-storage-migration-agent";
    const eventId = "normalized-storage-migration-event";
    const missingProjectionEventId = "normalized-storage-missing-projection";
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ($1,'family','Migration Agent','Careful')", [agentId]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ($1,$2,'internal',$3,'test','completed',$4)", [eventId, agentId, { summary: "美術館の予定を思い出した" }, fixtureInstant]);
    await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,result,started_at,finished_at) VALUES ('normalized-storage-migration-run',$1,$2,0,$3,$4,$4)", [agentId, eventId, { output: { desire: "整理する", action: { type: "no-external-action", reason: "maintenance" } }, toolExecutions: [] }, fixtureInstant]);
    await pool.query("INSERT INTO event_experiences(event_id,agent_id,summary,facts,subjects,occurred_at) VALUES ($1,$2,'美術館の予定を思い出した',$3,$4,$5)", [eventId, agentId, JSON.stringify(["来週に展示がある"]), JSON.stringify(["user-42"]), fixtureInstant]);
    await pool.query("INSERT INTO event_projections(event_id,agent_id,kind,content,subjects,occurred_at,embedding,embedding_model,embedding_dimension,embedding_status) VALUES ($1,$2,'internal','legacy projection',$3,$4,$5::vector,'legacy-model',768,'ready')", [eventId, agentId, JSON.stringify(["user-42"]), fixtureInstant, `[${Array.from({ length: 768 }, () => 0).join(",")}]`]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ($1,$2,'internal',$3,'test','completed',$4)", [missingProjectionEventId, agentId, { summary: "Projectionが欠けた経験" }, fixtureInstant]);
    await pool.query("INSERT INTO event_experiences(event_id,agent_id,summary,facts,subjects,occurred_at) VALUES ($1,$2,'Projectionが欠けた経験','[]','[]',$3)", [missingProjectionEventId, agentId, fixtureInstant]);
    await pool.query("INSERT INTO experience_integrations(id,source_run_id,status) VALUES ('normalized-storage-active','normalized-storage-migration-run','pending')");
    await expect(migrateNormalizedEventStorage(database.admin, { apply: false, agentId })).resolves.toMatchObject({ apply: false, experiences: 2, subjects: 1, inconsistencies: 0, activeWorkItems: 1 });
    expect((await pool.query("SELECT 1 FROM event_subjects WHERE event_id=$1", [eventId])).rowCount).toBe(0);
    await expect(migrateNormalizedEventStorage(database.admin, { apply: true, agentId })).rejects.toThrow("active integration work items");
    await pool.query("DELETE FROM experience_integrations WHERE id='normalized-storage-active'");
    await expect(migrateNormalizedEventStorage(database.admin, { apply: true, agentId })).resolves.toMatchObject({ apply: true, experiences: 2, subjects: 1, inconsistencies: 0, activeWorkItems: 0 });
    expect((await pool.query<{ subject_id: string }>("SELECT subject_id FROM event_subjects WHERE event_id=$1", [eventId])).rows).toEqual([{ subject_id: "user-42" }]);
    const migratedProjection = (await pool.query<{ content_hash: string; embedding: string | null; embedding_status: string; embedding_model: string | null }>("SELECT content_hash,embedding::text,embedding_status,embedding_model FROM event_projections WHERE event_id=$1", [eventId])).rows[0];
    expect(migratedProjection?.content_hash).toMatch(/^[a-f0-9]{64}$/u);
    expect(migratedProjection).toMatchObject({ embedding: null, embedding_status: "pending", embedding_model: null });
    expect((await pool.query<{ embedding_status: string }>("SELECT embedding_status FROM event_projections WHERE event_id=$1", [missingProjectionEventId])).rows[0]).toEqual({ embedding_status: "pending" });
    const events = await new PostgresRetrievalService(pool).retrieveEvents({ agentId, query: "展示", subjectIds: ["user-42"], limit: 4 });
    const migratedEvent = events.find(({ id }) => id === eventId);
    expect(migratedEvent?.content).toContain("来週に展示がある");
    expect(migratedEvent?.matchedBy).toEqual(expect.arrayContaining(["keyword", "subject", "recency"]));
    expect(events.map(({ id }) => id)).toContain(missingProjectionEventId);
  });

  it("FR-82: repairs only the Event Experience of completed Integrations after the latest Reflection", async () => {
    const agentId = "experience-requeue-agent";
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ($1,'family','Experience Requeue Agent','Careful')", [agentId]);
    await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,relationships,mood) VALUES ($1,'Careful','Story','[]','[]','Calm')", [agentId]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('experience-requeue-event',$1,'internal',$2,'test','completed',$3)", [agentId, { summary: "補完対象のEvent" }, fixtureInstant]);
    await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,result,started_at,finished_at) VALUES ('experience-requeue-run',$1,'experience-requeue-event',0,$2,$3,$3)", [agentId, { output: { desire: "整理する", action: { type: "no-external-action", reason: "maintenance" } }, toolExecutions: [] }, fixtureInstant]);
    await pool.query("INSERT INTO experience_integrations(id,source_run_id,status,output,completed_at) VALUES ('experience-requeue-integration','experience-requeue-run','completed',$1,$2)", [{ experience: null, memories: [] }, fixtureInstant]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('experience-requeue-old-event',$1,'internal',$2,'test','completed','2026-01-01T00:00:00.000Z')", [agentId, { summary: "既にReflection済みのEvent" }]);
    await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,result,started_at,finished_at) VALUES ('experience-requeue-old-run',$1,'experience-requeue-old-event',0,$2,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')", [agentId, { output: { desire: "整理する", action: { type: "no-external-action", reason: "maintenance" } }, toolExecutions: [] }]);
    await pool.query("INSERT INTO experience_integrations(id,source_run_id,status,output,completed_at) VALUES ('experience-requeue-old-integration','experience-requeue-old-run','completed',$1,'2026-01-01T00:00:00.000Z')", [{ experience: null, memories: [] }]);
    await pool.query("INSERT INTO reflection_runs(id,agent_id,input_state_version,status,input,completed_at) VALUES ('experience-requeue-reflection',$1,0,'completed',$2,'2026-01-02T00:01:00.000Z')", [agentId, { eventWindowEnd: "2026-01-02T00:00:00.000Z" }]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('experience-requeue-tool-event',$1,'tool-result',$2,'test','completed',$3)", [agentId, { summary: "検索結果" }, fixtureInstant]);
    await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,result,started_at,finished_at) VALUES ('experience-requeue-tool-run',$1,'experience-requeue-tool-event',0,$2,$3,$3)", [agentId, { output: { desire: "整理する", action: { type: "no-external-action", reason: "maintenance" } }, toolExecutions: [] }, fixtureInstant]);
    await pool.query("INSERT INTO experience_integrations(id,source_run_id,status,output,completed_at) VALUES ('experience-requeue-tool-integration','experience-requeue-tool-run','completed',$1,$2)", [{ experience: null, memories: [] }, fixtureInstant]);
    const repository = new PostgresExperienceIntegrationRepository(createRuntimeDatabase(pool), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    await expect(repository.missingEventExperienceCandidates(agentId)).resolves.toEqual([{ id: "experience-requeue-integration", agentId }]);
    const core = agentCoreInputFixture();
    const input = { ...core, run: { ...core.run, agentId, eventId: "experience-requeue-event", runId: "experience-requeue-run", occurredAt: fixtureInstant }, observation: { ...core.observation, eventId: "experience-requeue-event" }, currentSelf: { ...core.currentSelf, agentId }, state: { ...core.state, agentId } };
    await repository.repairEventExperience({ integrationId: "experience-requeue-integration", agentId, sourceEvent: { id: "experience-requeue-event", agentId, kind: "internal", occurredAt: fixtureInstant, payload: {} }, sourceRunId: "experience-requeue-run", input, result: { output: { desire: "整理する", action: { type: "no-external-action", reason: "maintenance" } }, toolExecutions: [] } }, { summary: "補完対象のEventを整理した", facts: ["Event Experienceを補完した"] });
    expect((await pool.query<{ status: string; mood: string; output: { memories: unknown[]; experience: { summary: string } } }>("SELECT i.status,i.output,s.mood FROM experience_integrations i JOIN agent_runs r ON r.id=i.source_run_id JOIN agent_states s ON s.agent_id=r.agent_id WHERE i.id='experience-requeue-integration' ")).rows[0]).toMatchObject({ status: "completed", mood: "Calm", output: { memories: [], experience: { summary: "補完対象のEventを整理した" } } });
    expect((await pool.query("SELECT 1 FROM event_experiences WHERE event_id='experience-requeue-event'")).rowCount).toBe(1);
  });

  it("FR-31, FR-41, FR-44: commits Reflection organization and Memory atomically without creating a Concern", async () => {
    await setConcerns("a", [{ id: "concern-1", description: "信頼を守る方法を確認する", whyItMatters: "約束を重視している", status: "active" }]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('reflection-event','a','user-message',$1,'test','completed',$2)", [{ summary: "約束を果たした" }, fixtureInstant]);
    await recordExperience("reflection-event", "約束を果たした");
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,embedding_status) VALUES ('reflection-evidence','a','episodic','約束を果たした経験','信頼が深まった',now(),'pending') ON CONFLICT DO NOTHING");
    const repository = new PostgresReflectionRepository(createRuntimeDatabase(pool), new SequenceIdGenerator(["reflection-memory"]), () => new Date("2026-01-02T00:00:00Z"));
    const input = await repository.load("reflection-1", "a"); if (input === undefined) throw new Error("Reflection input was not created");
    const output = { memories: [{ summary: "約束を果たした", significance: "信頼が深まった", subjects: ["owner"], occurredAt: fixtureInstant }], concernChanges: [{ operation: "upsert" as const, concern: { id: "concern-1", description: "信頼を守る", whyItMatters: "約束を重視している", status: "active" as const } }], relationshipChanges: [{ operation: "upsert" as const, relationship: { subjectId: "owner", description: "約束を守り合える相手" } }], mood: "穏やかな達成感", evidenceMemoryIds: ["reflection-evidence"] };
    await expect(repository.commit(input, output)).resolves.toBe("committed");
    await expect(repository.commit(input, output)).resolves.toBe("duplicate");
    expect(await getConcerns("a")).toMatchObject([{ id: "concern-1" }]);
    expect((await pool.query<{ relationships: { subjectId: string }[] }>("SELECT relationships FROM agent_states WHERE agent_id='a'")).rows[0]).toMatchObject({ relationships: [{ subjectId: "owner" }] });
    expect((await pool.query<{ content: string; importance: string }>("SELECT content,importance FROM memories WHERE id='reflection-memory'")).rows[0]).toEqual({ content: "約束を果たした", importance: "信頼が深まった" });
    expect((await pool.query("SELECT id FROM autonomous_schedules WHERE agent_id='a' AND kind='concern-due'")).rowCount).toBe(0);
    expect((await pool.query<{ status: string; plan: { memory: string } }>("SELECT status,plan FROM reflection_runs WHERE id='reflection-1'")).rows[0]).toMatchObject({ status: "completed", plan: { memory: "completed" } });
    expect((await pool.query<{ concern_id: string; kind: string; reflection_id: string; evidence_memory_ids: string[] }>("SELECT ca.concern_id,ca.kind,ca.reflection_id,ca.evidence_memory_ids FROM concern_activities ca JOIN concerns c ON c.id=ca.concern_id WHERE c.agent_id='a' AND ca.reflection_id='reflection-1' ORDER BY ca.concern_id,ca.kind")).rows).toEqual([
      { concern_id: "concern-1", kind: "presented", reflection_id: "reflection-1", evidence_memory_ids: [] },
      { concern_id: "concern-1", kind: "reviewed", reflection_id: "reflection-1", evidence_memory_ids: ["reflection-evidence"] },
    ]);
  });

  it("C-06, C-24: retains a Concern beyond the context selection boundary when a normal Event commits", async () => {
    const concerns: Concern[] = [...Array.from({ length: 12 }, (_, index) => ({ id: `history-${String(index)}`, description: `解決済みの関心 ${String(index)}`, whyItMatters: "過去の記録", status: "satisfied" as const })), { id: "active-after-history", description: "次のEventにも残る関心", whyItMatters: "まだ確かめたい", status: "active" as const }];
    await setConcerns("a", concerns);
    await pool.query("UPDATE agent_states SET version=version+1 WHERE agent_id='a'");
    const tools = new ToolRegistry(createAgentContextTools(new PostgresAgentContextToolRepository(createRuntimeDatabase(pool))));
    const loader = new PostgresAgentContextLoader({
      database: createRuntimeDatabase(pool), ids: new SequenceIdGenerator(["context-boundary-run"]), embedding: new FakeEmbeddingProvider({}), tools,
      budget: { maxTokens: 6_000, maxMemories: 1, maxSocialContexts: 1 },
      limits: { deadlineMs: 1_000, maxSteps: 4, maxToolCalls: 0, maxHops: 4, maxAttempts: 3 }
    });
    const persistence = new PostgresRuntimePersistence(createRuntimeDatabase(pool), (event) => loader.load(event), new SequenceIdGenerator(["context-boundary-state-change"]), () => new Date(fixtureInstant));
    const runtime = new AgentRuntime({
      destination: "a", defaultOutputDestination: "terminal", persistence,
      queue: { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() },
      ids: new SequenceIdGenerator(["new-concern"]), now: () => new Date(fixtureInstant),
      harness: { run: (input) => {
        expect(input.state.concerns).toEqual([]);
        return Promise.resolve({ output: { desire: "関心を維持する", action: { type: "no-external-action", reason: "内部状態を更新した" } }, toolExecutions: [], concernProposals: [{ operation: "create", description: "新しい関心", whyItMatters: "今回の経験から残ったため" }] });
      } }
    });
    await expect(runtime.process({ id: "context-boundary-event", agentId: "a", kind: "internal", occurredAt: fixtureInstant, payload: { reason: "状態を継続する", destination: "terminal" } }, new AbortController().signal)).resolves.toMatchObject({ type: "no-external-action" });
    const persisted = await getConcerns("a");
    expect(persisted).toEqual(expect.arrayContaining([expect.objectContaining({ id: "active-after-history", status: "active" }), expect.objectContaining({ id: "new-concern", status: "active" })]));
  });

  it("FR-69, NFR-1: pages owned active Concerns and returns only their Activity evidence", async () => {
    await setConcerns("a", [
      { id: "history-old", description: "古いConcern", whyItMatters: "比較するため", status: "active" },
      { id: "history-new", description: "新しいConcern", whyItMatters: "比較するため", status: "active" }
    ]);
    await pool.query("INSERT INTO concerns(id,agent_id,description,why_it_matters,status) VALUES ('history-foreign-concern','b','他AgentのConcern','分離確認','active') ON CONFLICT (id) DO UPDATE SET deleted_at=NULL");
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,embedding_status) VALUES ('history-evidence','a','episodic','Concernの根拠','確認したい',now(),'pending') ON CONFLICT DO NOTHING");
    await pool.query(`INSERT INTO concern_activities(id,concern_id,kind,evidence_memory_ids,occurred_at) VALUES
      ('history-old-created','history-old','created','["history-evidence"]','2026-01-01T00:00:00.000Z'),
      ('history-old-reviewed','history-old','reviewed','[]','2026-01-01T00:00:00.000Z'),
      ('history-new-created','history-new','created','[]','2026-02-01T00:00:00.000Z'),
      ('history-foreign','history-foreign-concern','created','[]','2026-03-01T00:00:00.000Z')`);
    const registry = new ToolRegistry(createAgentContextTools(new PostgresAgentContextToolRepository(createRuntimeDatabase(pool)))); const context = { agentId: "a", runId: "history-run", idempotencyKey: "history-list" }; const signal = new AbortController().signal;
    await expect(registry.execute("concern_list", { limit: 1, cursor: 0, order: "stale" }, context, signal)).resolves.toEqual({ ok: true, value: { count: 2, concerns: [expect.objectContaining({ id: "history-old" })], nextCursor: 1 } });
    await expect(registry.execute("concern_list", { limit: 1, cursor: 1, order: "stale" }, { ...context, idempotencyKey: "history-list-2" }, signal)).resolves.toEqual({ ok: true, value: { count: 2, concerns: [expect.objectContaining({ id: "history-new" })] } });
    await expect(registry.execute("concern_history", { concernId: "history-old" }, { ...context, idempotencyKey: "history-detail" }, signal)).resolves.toMatchObject({ ok: true, value: { concernId: "history-old", history: [expect.objectContaining({ kind: "reviewed" }), expect.objectContaining({ kind: "created", evidenceMemoryIds: ["history-evidence"] })], evidenceMemories: [expect.objectContaining({ id: "history-evidence" })] } });
    const firstPage = await registry.execute("concern_history", { concernId: "history-old", limit: 1 }, { ...context, idempotencyKey: "history-page-1" }, signal);
    if (!firstPage.ok) throw new Error("Concern history was not available");
    const nextCursor = (firstPage.value as { nextCursor: { occurredAt: string; id: string } }).nextCursor;
    const secondPage = await registry.execute("concern_history", { concernId: "history-old", limit: 1, cursor: nextCursor }, { ...context, idempotencyKey: "history-page-2" }, signal);
    expect(secondPage.ok).toBe(true);
    if (!secondPage.ok) throw new Error("Second Concern history page was not available");
    expect((secondPage.value as { history: readonly unknown[] }).history).toHaveLength(1);
    await setConcerns("a", []);
  });

  it("FR-60, AC-15: records memory failure as blocked targets and leaves the reflection retryable", async () => {
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('reflection-fail-event','a','user-message',$1,'test','completed',now())", [{ summary: "再試行対象の出来事" }]);
    await recordExperience("reflection-fail-event", "再試行対象の出来事");
    const repository = new PostgresReflectionRepository(createRuntimeDatabase(pool), new SequenceIdGenerator(["reflection-fail-memory"]), () => new Date("2026-01-02T00:00:00Z"), { enqueue: () => Promise.resolve(), enqueueAndWait: () => Promise.reject(new Error("memory unavailable")) });
    const input = await repository.load("reflection-fail", "a"); if (input === undefined) throw new Error("Reflection input was not created");
    const output = { memories: [{ summary: "失敗時の記憶", significance: "再試行の確認", subjects: [], occurredAt: fixtureInstant }], concernChanges: [], relationshipChanges: [], evidenceMemoryIds: [] };
    await expect(repository.commit(input, output)).resolves.toBe("committed");
    const row = await pool.query<{ status: string; plan: { memory: string; self: string; relationship: string; concern: string } }>("SELECT status,plan FROM reflection_runs WHERE id='reflection-fail'");
    expect(row.rows[0]).toMatchObject({ status: "pending", plan: { memory: "failed", self: "blocked", relationship: "blocked", concern: "blocked" } });
    expect((await pool.query("SELECT 1 FROM memories WHERE content='失敗時の記憶'")).rowCount).toBe(0);
  });

  it("FR-42, NFR-7: records Reflection validation paths without persisting invalid model output", async () => {
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('reflection-validation-event','a','internal',$1,'test','completed',now())", [{ summary: "検証失敗を監査する" }]);
    await recordExperience("reflection-validation-event", "検証失敗を監査する");
    const repository = new PostgresReflectionRepository(createRuntimeDatabase(pool), new SequenceIdGenerator([]), () => new Date("2026-01-02T00:00:00Z"));
    const input = await repository.load("reflection-validation", "a");
    if (input === undefined) throw new Error("Reflection input was not created");
    await repository.fail(input, new DomainError("VALIDATION", "Reflection output failed schema validation", { cause: { validationIssues: [{ code: "custom", path: ["selfChangeReason"], message: "selfChangeReason requires all Self fields", invalidOutput: "must-not-persist" }] } }));
    const failure = (await pool.query<{ failure_reason: string; output: unknown }>("SELECT failure_reason,output FROM reflection_runs WHERE id='reflection-validation'")).rows[0];
    expect(failure?.failure_reason).toContain("selfChangeReason");
    expect(failure?.failure_reason).not.toContain("must-not-persist");
    expect(failure?.output).toBeNull();
  });

  it("FR-25: applies satisfied and abandoned Concern changes through Reflection", async () => {
    await setConcerns("a", [
      { id: "concern-satisfied", description: "確認を終える", whyItMatters: "次の判断に進むため", status: "active" },
      { id: "concern-abandoned", description: "追跡をやめる", whyItMatters: "価値が下がったため", status: "active" },
      { id: "concern-removed", description: "重複を消す", whyItMatters: "重複しているため", status: "active" }
    ]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('reflection-lifecycle-event','a','internal',$1,'test','completed',now())", [{ summary: "Concernを整理する経験" }]);
    await recordExperience("reflection-lifecycle-event", "Concernを整理する経験");
    const repository = new PostgresReflectionRepository(createRuntimeDatabase(pool), new SequenceIdGenerator([]), () => new Date("2026-01-02T00:00:00Z"));
    const input = await repository.load("reflection-lifecycle", "a");
    if (input === undefined) throw new Error("Reflection input was not created");
    await expect(repository.commit(input, {
      memories: [],
      concernChanges: [
        { operation: "upsert", concern: { id: "concern-satisfied", description: "確認を終える", whyItMatters: "次の判断に進むため", status: "satisfied" } },
        { operation: "upsert", concern: { id: "concern-abandoned", description: "追跡をやめる", whyItMatters: "価値が下がったため", status: "abandoned" } },
        { operation: "remove", id: "concern-removed" }
      ],
      relationshipChanges: [],
      evidenceMemoryIds: []
    })).resolves.toBe("committed");
    const state = await getConcerns("a");
    expect(state).toMatchObject([
      { id: "concern-satisfied", status: "satisfied" },
      { id: "concern-abandoned", status: "abandoned" }
    ]);
    expect(state.some(({ id }) => id === "concern-removed")).toBe(false);
    expect((await pool.query<{ deleted_at: Date | null }>("SELECT deleted_at FROM concerns WHERE id='concern-removed'")).rows[0]?.deleted_at).toBeInstanceOf(Date);
    await setConcerns("a", []);
    await pool.query("DELETE FROM reflection_runs WHERE id='reflection-lifecycle'");
  });

  it("FR-44: rejects a Concern Reflector create before the targeted writer can persist it", async () => {
    await setConcerns("a", [{ id: "existing-concern", description: "既存Concern", whyItMatters: "まだ確かめたい", status: "active" }]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('reflection-no-create-event','a','internal',$1,'test','completed',now())", [{ summary: "既存Concernを整理する" }]);
    await recordExperience("reflection-no-create-event", "既存Concernを整理する");
    const repository = new PostgresReflectionRepository(createRuntimeDatabase(pool), new SequenceIdGenerator(["forbidden-concern"]), () => new Date("2026-01-02T00:00:00Z"));
    const input = await repository.load("reflection-no-create", "a");
    if (input === undefined) throw new Error("Reflection input was not created");
    await repository.beginTarget(input, "concern");
    await expect(repository.commitTarget(input, "concern", { output: { concernChanges: [{ operation: "create", description: "新規Concern", whyItMatters: "Reflectionでは作らない" }] }, toolExecutions: [] })).rejects.toThrow();
    expect(await getConcerns("a")).toEqual([expect.objectContaining({ id: "existing-concern" })]);
    expect((await pool.query("SELECT id FROM concerns WHERE id='forbidden-concern'")).rowCount).toBe(0);
  });

  it("FR-25, NFR-7: closes only stale, repeatedly presented Concerns at Reflection completion", async () => {
    const concerns = [
      { id: "stale-close", description: "長く進展のない関心", whyItMatters: "以前は重要だった", status: "active" },
      { id: "future-due", description: "予定時刻まで待つ関心", whyItMatters: "予定がある", status: "active" },
      { id: "too-recent", description: "まだ期間を満たさない関心", whyItMatters: "最近進展した", status: "active" },
      { id: "too-few-sessions", description: "再検討機会が足りない関心", whyItMatters: "再検討を待つ", status: "active" },
      { id: "reviewed-now", description: "今回見直す関心", whyItMatters: "まだ判断する", status: "active" }
    ];
    await setConcerns("a", concerns as Concern[]);
    await pool.query("UPDATE agent_states SET version=version+1 WHERE agent_id='a'");
    for (const id of ["stale-session-1", "stale-session-2"]) await pool.query("INSERT INTO reflection_runs(id,agent_id,input_state_version,status,input,completed_at) VALUES ($1,'a',0,'completed','{}','2026-01-10T00:00:00.000Z')", [id]);
    await pool.query(`INSERT INTO concern_activities(id,concern_id,kind,reflection_id,evidence_memory_ids,occurred_at) VALUES
      ('stale-baseline','stale-close','baseline',NULL,'[]','2025-12-01T00:00:00.000Z'),
      ('stale-presented-1','stale-close','presented','stale-session-1','[]','2026-01-01T00:00:00.000Z'),
      ('stale-presented-2','stale-close','presented','stale-session-2','[]','2026-01-10T00:00:00.000Z'),
      ('future-baseline','future-due','baseline',NULL,'[]','2025-12-01T00:00:00.000Z'),
      ('future-presented-1','future-due','presented','stale-session-1','[]','2026-01-01T00:00:00.000Z'),
      ('future-presented-2','future-due','presented','stale-session-2','[]','2026-01-10T00:00:00.000Z'),
      ('recent-baseline','too-recent','baseline',NULL,'[]','2026-02-01T00:00:00.000Z'),
      ('recent-presented-1','too-recent','presented','stale-session-1','[]','2026-02-02T00:00:00.000Z'),
      ('recent-presented-2','too-recent','presented','stale-session-2','[]','2026-02-03T00:00:00.000Z'),
      ('few-baseline','too-few-sessions','baseline',NULL,'[]','2025-12-01T00:00:00.000Z')`);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('stale-close-event','a','internal',$1,'test','completed','2026-02-10T00:00:00.000Z')", [{ summary: "Concernを再検討する" }]);
    await recordExperience("stale-close-event", "Concernを再検討する");
    const repository = new PostgresReflectionRepository(createRuntimeDatabase(pool), new SequenceIdGenerator([]), () => new Date("2026-02-15T00:00:00.000Z"), undefined, undefined, { staleAfterMs: 30 * 24 * 60 * 60 * 1000, minReflectionSessions: 2 });
    const input = await repository.load("stale-close-reflection", "a"); if (input === undefined) throw new Error("Reflection input was not created");
    const output = { memories: [], concernChanges: [{ operation: "upsert" as const, concern: { id: "reviewed-now", description: "今回見直す関心", whyItMatters: "まだ判断する", status: "active" as const } }], relationshipChanges: [], evidenceMemoryIds: [] };
    await expect(repository.commit(input, output)).resolves.toBe("committed");
    await expect(repository.commit(input, output)).resolves.toBe("duplicate");
    expect(await getConcerns("a")).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "stale-close", status: "abandoned" }),
      expect.objectContaining({ id: "future-due", status: "abandoned" }),
      expect.objectContaining({ id: "too-recent", status: "active" }),
      expect.objectContaining({ id: "too-few-sessions", status: "active" }),
      expect.objectContaining({ id: "reviewed-now", status: "active" })
    ]));
    expect((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM concern_activities ca JOIN concerns c ON c.id=ca.concern_id WHERE c.agent_id='a' AND ca.concern_id='stale-close' AND ca.kind='closed'")).rows[0]?.count).toBe("1");
    await setConcerns("a", []);
    await pool.query("DELETE FROM reflection_runs WHERE id=ANY($1::text[])", [["stale-session-1", "stale-session-2", "stale-close-reflection"]]);
  });

  it("FR-25, FR-60, NFR-17: targeted Concern retries a stale-close version conflict without synchronizing a schedule", async () => {
    const agentId = "targeted-concern-close-agent";
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ($1,'family','Targeted Concern Agent','Careful')", [agentId]);
    await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,relationships,mood) VALUES ($1,'Careful','Story','[]','[]','Calm')", [agentId]);
    await setConcerns(agentId, [{ id: "targeted-stale", description: "進展のないConcern", whyItMatters: "以前は重要だった", status: "active" }]);
    await pool.query("INSERT INTO concern_activities(id,concern_id,kind,evidence_memory_ids,occurred_at) VALUES ('targeted-stale-baseline','targeted-stale','baseline','[]','2025-12-01T00:00:00.000Z')");
    const runtimeDatabase = createRuntimeDatabase(pool);
    const repository = new PostgresReflectionRepository(runtimeDatabase, new SequenceIdGenerator([]), () => new Date("2026-02-15T00:00:00.000Z"), undefined, undefined, { staleAfterMs: 30 * 24 * 60 * 60 * 1000, minReflectionSessions: 2 });
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('targeted-close-event-1',$1,'internal',$2,'test','completed',now()-interval '1 hour')", [agentId, { summary: "Concernを再検討する" }]);
    await recordExperience("targeted-close-event-1", "Concernを再検討する");
    const first = await repository.load("targeted-close-reflection-1", agentId);
    if (first === undefined) throw new Error("Reflection input was not created");
    await repository.beginTarget(first, "concern");
    await repository.commitTarget(first, "concern", { output: { concernChanges: [] }, toolExecutions: [] });
    await repository.complete(first);
    const currentVersion = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id=$1", [agentId])).rows[0]?.version;
    if (currentVersion === undefined) throw new Error("Agent State was not updated");
    const second = { ...first, reflectionId: "targeted-close-reflection-2", expectedVersion: currentVersion };
    await pool.query("INSERT INTO reflection_runs(id,agent_id,input_state_version,status,input) VALUES ($1,$2,$3,'pending',$4)", [second.reflectionId, agentId, second.expectedVersion, JSON.stringify(second)]);
    await repository.beginTarget(second, "concern");
    await repository.commitTarget(second, "concern", { output: { concernChanges: [] }, toolExecutions: [] });
    let conflictInjected = false;
    const conflictingDatabase = {
      ...runtimeDatabase,
      transaction: (async (callback: Parameters<typeof runtimeDatabase.transaction>[0]) => {
        if (!conflictInjected) {
          conflictInjected = true;
          await pool.query("UPDATE agent_states SET version=version+1 WHERE agent_id=$1", [agentId]);
        }
        return runtimeDatabase.transaction(callback);
      }) as typeof runtimeDatabase.transaction
    };
    const conflictingRepository = new PostgresReflectionRepository(conflictingDatabase, new SequenceIdGenerator([]), () => new Date("2026-02-15T00:00:00.000Z"), undefined, undefined, { staleAfterMs: 30 * 24 * 60 * 60 * 1000, minReflectionSessions: 2 });
    await expect(conflictingRepository.complete(second)).rejects.toMatchObject({ code: "EXTERNAL", message: "Reflection has retryable target failures" });
    expect((await pool.query<{ status: string; failure_reason: string | null }>("SELECT status,failure_reason FROM reflection_runs WHERE id=$1", [second.reflectionId])).rows[0]).toEqual({ status: "pending", failure_reason: "Reflection has retryable target failures" });
    const retry = await repository.load("new-reflection-after-conflict", agentId);
    expect(retry?.reflectionId).toBe(second.reflectionId);
    if (retry === undefined) throw new Error("Retryable Reflection input was not loaded");
    await repository.complete(retry);
    await repository.complete(retry);
    const attempt = await pool.query<{ input: { concernContext: { total: number; active: number; selected: number; memorySelected: number; estimatedContentTokens: number } } }>("SELECT input FROM reflection_attempts WHERE reflection_id=$1 AND target='concern'", [second.reflectionId]);
    expect(attempt.rows[0]?.input).toMatchObject({ concernContext: { total: 1, active: 1, selected: 1, memorySelected: first.memories.length } });
    expect(await getConcerns(agentId)).toEqual([expect.objectContaining({ id: "targeted-stale", status: "abandoned" })]);
    expect((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM concern_activities ca JOIN concerns c ON c.id=ca.concern_id WHERE c.agent_id=$1 AND ca.concern_id='targeted-stale' AND ca.kind='presented'", [agentId])).rows[0]?.count).toBe("2");
    expect((await pool.query<{ kind: string; count: string }>("SELECT kind,count(*)::text AS count FROM concern_activities WHERE concern_id='targeted-stale' AND kind=ANY(ARRAY['status-changed','closed']) GROUP BY kind ORDER BY kind")).rows).toEqual([{ kind: "closed", count: "1" }, { kind: "status-changed", count: "1" }]);
    expect((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM autonomous_schedules WHERE agent_id=$1 AND kind='concern-due'", [agentId])).rows[0]?.count).toBe("0");
    await pool.query("DELETE FROM events WHERE agent_id=$1", [agentId]);
    await pool.query("DELETE FROM agents WHERE id=$1", [agentId]);
  });

  it("FR-60, NFR-17: persists target attempts and leaves only failed targets retryable", async () => {
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('target-attempt-event','a','internal',$1,'test','completed',now())", [{ summary: "対象別に統合する" }]);
    await recordExperience("target-attempt-event", "対象別に統合する");
    const repository = new PostgresReflectionRepository(createRuntimeDatabase(pool), new SequenceIdGenerator(["target-attempt-resolution", "target-attempt-spare", "target-attempt-retry-resolution"]), () => new Date("2026-01-02T00:00:00Z"));
    const input = await repository.load("target-attempt-reflection", "a"); if (input === undefined) throw new Error("Reflection input was not created");
    await expect(repository.beginTarget(input, "memory")).resolves.toBe("pending");
    await repository.commitTarget(input, "memory", { output: { memories: [] }, toolExecutions: [{ callId: "reflector-tool-1", runId: input.reflectionId, eventId: input.reflectionId, name: "memory_search", input: { query: "約束" }, ok: true, result: { memories: [] }, startedAt: fixtureInstant, finishedAt: fixtureInstant }] });
    await expect(repository.beginTarget(input, "reconciliation")).resolves.toBe("pending");
    await repository.beginTarget(input, "concern");
    await repository.failTarget(input, "concern", new Error("Concern evidence unavailable"));
    await repository.blockTarget(input, "relationship");
    await repository.blockTarget(input, "self-mood");
    await expect(repository.complete(input)).rejects.toMatchObject({ code: "EXTERNAL" });
    expect((await pool.query<{ target: string; status: string; input: unknown; output: unknown }>("SELECT target,status,input,output FROM reflection_attempts WHERE reflection_id='target-attempt-reflection' ORDER BY target")).rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: "memory", status: "completed", output: { memories: [] } }),
      expect.objectContaining({ target: "reconciliation", status: "pending" }),
      expect.objectContaining({ target: "concern", status: "failed" }),
      expect.objectContaining({ target: "relationship", status: "blocked" }),
      expect.objectContaining({ target: "self-mood", status: "blocked" })
    ]));
    expect((await pool.query<{ tool: string; input: unknown }>("SELECT tool,input FROM reflection_tool_executions WHERE reflection_id='target-attempt-reflection' ORDER BY execution_index")).rows).toEqual([{ tool: "memory_search", input: { query: "約束" } }]);
    expect((await pool.query<{ input: Record<string, unknown> }>("SELECT input FROM reflection_attempts WHERE reflection_id='target-attempt-reflection' AND target='memory'")).rows[0]?.input).not.toHaveProperty("events");
    expect((await pool.query<{ agent_id: string | null; tool_executions: unknown }>("SELECT agent_id,tool_executions FROM reflection_attempts WHERE reflection_id='target-attempt-reflection' AND target='memory'")).rows[0]).toEqual({ agent_id: null, tool_executions: null });
    await repository.commitTarget(input, "memory", { output: { memories: [] }, toolExecutions: [{ callId: "reflector-tool-2", runId: input.reflectionId, eventId: input.reflectionId, name: "memory_search", input: { query: "更新" }, ok: true, result: { memories: [] }, startedAt: fixtureInstant, finishedAt: fixtureInstant }] });
    expect((await pool.query<{ tool_call_id: string }>("SELECT tool_call_id FROM reflection_tool_executions WHERE reflection_id='target-attempt-reflection' AND target='memory'")).rows).toEqual([{ tool_call_id: "reflector-tool-2" }]);
    await pool.query("UPDATE reflection_attempts SET tool_executions=$2 WHERE reflection_id=$1 AND target='memory'", [input.reflectionId, JSON.stringify([{ callId: "legacy-failed-call" }])]);
    await repository.commitTarget(input, "memory", { output: { memories: [] }, toolExecutions: [] });
    expect((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM reflection_tool_executions WHERE reflection_id='target-attempt-reflection' AND target='memory'")).rows[0]?.count).toBe("0");
    expect((await pool.query<{ tool_executions: unknown }>("SELECT tool_executions FROM reflection_attempts WHERE reflection_id=$1 AND target='memory'", [input.reflectionId])).rows[0]?.tool_executions).toBeNull();
    expect((await pool.query<{ status: string; failure_reason: string | null; plan: { memory: string; concern: string } }>("SELECT status,failure_reason,plan FROM reflection_runs WHERE id='target-attempt-reflection'")).rows[0]).toMatchObject({ status: "pending", failure_reason: "Reflection has retryable target failures", plan: { memory: "completed", concern: "failed" } });
    expect((await repository.load("new-reflection-after-target-failure", "a"))?.reflectionId).toBe(input.reflectionId);
    await pool.query("DELETE FROM reflection_runs WHERE id='target-attempt-reflection'");
  });

  it("FR-41, NFR-7: backfills legacy Reflection Tool arrays into one relational row per call", async () => {
    const agentId = "legacy-reflection-tools-agent";
    const execution = { callId: "legacy-tool-1", runId: "legacy-reflection-tools", eventId: "legacy-reflection-tools", name: "memory_search", input: { query: "展示" }, ok: true, result: { memories: [] }, startedAt: fixtureInstant, finishedAt: fixtureInstant };
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ($1,'family','Legacy Tool Agent','Careful')", [agentId]);
    await pool.query("INSERT INTO reflection_runs(id,agent_id,input_state_version,status,input,completed_at) VALUES ('legacy-reflection-tools',$1,0,'completed','{}',now())", [agentId]);
    await pool.query("INSERT INTO reflection_attempts(id,reflection_id,agent_id,target,status,input,tool_executions,completed_at) VALUES ('legacy-reflection-tools:concern','legacy-reflection-tools',$1,'concern','completed','{}',$2,now())", [agentId, JSON.stringify([execution])]);
    await expect(backfillReflectionToolExecutions(database.admin, { apply: false, agentId })).resolves.toMatchObject({ sourceScopes: 1, validExecutions: 1, invalidExecutions: 0, inserted: 0 });
    await pool.query("INSERT INTO reflection_runs(id,agent_id,input_state_version,status,input) VALUES ('legacy-reflection-tools-active',$1,0,'pending','{}')", [agentId]);
    await expect(backfillReflectionToolExecutions(database.admin, { apply: true, agentId })).rejects.toThrow("unfinished Reflection Sessions");
    await pool.query("DELETE FROM reflection_runs WHERE id='legacy-reflection-tools-active'");
    await expect(backfillReflectionToolExecutions(database.admin, { apply: true, agentId })).resolves.toMatchObject({ sourceScopes: 1, validExecutions: 1, inserted: 1, activeScopes: 0 });
    expect((await pool.query<{ target: string; tool: string; tool_call_id: string }>("SELECT target,tool,tool_call_id FROM reflection_tool_executions WHERE reflection_id='legacy-reflection-tools'")).rows).toEqual([{ target: "concern", tool: "memory_search", tool_call_id: "legacy-tool-1" }]);
    await pool.query("DELETE FROM reflection_tool_executions WHERE reflection_id='legacy-reflection-tools'");
    await expect(backfillReflectionToolExecutions(database.admin, { apply: true, agentId })).resolves.toMatchObject({ sourceScopes: 0, inserted: 0 });
    expect((await pool.query<{ tool_executions: unknown }>("SELECT tool_executions FROM reflection_attempts WHERE reflection_id='legacy-reflection-tools'")).rows[0]).toEqual({ tool_executions: null });
    await pool.query("INSERT INTO reflection_runs(id,agent_id,input_state_version,status,input,completed_at) VALUES ('legacy-reflection-tools-invalid',$1,0,'completed','{}',now())", [agentId]);
    await pool.query("INSERT INTO reflection_attempts(id,reflection_id,agent_id,target,status,input,tool_executions,completed_at) VALUES ('legacy-reflection-tools-invalid:concern','legacy-reflection-tools-invalid',$1,'concern','completed','{}','[{\"bad\":true}]',now())", [agentId]);
    await expect(backfillReflectionToolExecutions(database.admin, { apply: true, agentId })).rejects.toThrow("invalid legacy executions");
    await pool.query("DELETE FROM agents WHERE id=$1", [agentId]);
  });

  it("FR-73: excludes Memory formed by this Reflection Session from immediate Reconciliation anchors", async () => {
    const agentId = "reconciliation-formation-agent";
    const reflectionId = "reconciliation-formation-session";
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ($1,'family','Reconciliation Agent','Careful')", [agentId]);
    await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,relationships,mood) VALUES ($1,'Careful','Story','[]','[]','Calm')", [agentId]);
    await pool.query(`INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,embedding_status) VALUES
      ('reconciliation-old',$1,'semantic','以前からある事実','後続Eventで再検討できる','2026-01-01T00:00:00Z','pending'),
      ('reconciliation-episodic',$1,'episodic','一回の出来事','書き換えない','2026-01-01T00:00:00Z','pending'),
      ('reconciliation-no-later',$1,'semantic','後続Eventのない事実','まだ再検討できない','2026-01-02T12:00:00Z','pending'),
      ('reconciliation-formed',$1,'self-change','今回Formationした経験','まだ後続Eventがない','2026-01-02T00:00:00Z','pending')`, [agentId]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('reconciliation-later-event',$1,'internal',$2,'test','completed','2026-01-02T00:00:00Z')", [agentId, { summary: "既存Memoryより後の経験" }]);
    await pool.query("INSERT INTO memory_mutations(id,agent_id,memory_id,operation,source_event_id,intent_index,intent) VALUES ('reconciliation-formed-mutation',$1,'reconciliation-formed','create',$2,0,'{}')", [agentId, `${reflectionId}:memory:0`]);
    const repository = new PostgresReflectionRepository(createRuntimeDatabase(pool), new SequenceIdGenerator(["reconciliation-resolution-audit"]), () => new Date("2026-01-03T00:00:00Z"));
    const session: ReflectionInput = {
      reflectionId, agentId, expectedVersion: 0,
      self: { identity: "Reconciliation Agent", disposition: "Careful", selfStory: "Story", commitments: [] },
      state: { mood: "Calm", concerns: [], relationships: [] },
      eventWindowEnd: "2026-01-03T00:00:00Z",
      events: [{ id: "reconciliation-event", occurredAt: "2026-01-03T00:00:00Z", summary: "現在のEvent" }],
      memories: []
    };
    await pool.query("INSERT INTO reflection_runs(id,agent_id,input_state_version,status,input) VALUES ($1,$2,0,'pending',$3)", [reflectionId, agentId, JSON.stringify(session)]);
    const selected = await repository.reconciliationInput(session);
    expect(selected.memories.map(({ id }) => id)).toContain("reconciliation-old");
    expect(selected.memories.map(({ id }) => id)).not.toContain("reconciliation-formed");
    expect(selected.memories.map(({ id }) => id)).not.toContain("reconciliation-episodic");
    expect(selected.memories.map(({ id }) => id)).not.toContain("reconciliation-no-later");
    expect((await pool.query<{ input: ReflectionInput }>("SELECT input FROM reflection_runs WHERE id=$1", [reflectionId])).rows[0]?.input.reconciliationAnchors?.map(({ id }) => id)).toEqual(selected.memories.map(({ id }) => id));
    const resumed = await repository.reconciliationInput(await repository.refresh(selected));
    expect(resumed.reconciliationAnchors?.map(({ id }) => id)).toEqual(selected.memories.map(({ id }) => id));
    expect(resumed.memories.map(({ id }) => id)).toEqual(selected.memories.map(({ id }) => id));
    const anchor = selected.memories[0];
    if (anchor === undefined) throw new Error("Reconciliation anchor was not selected");
    await repository.beginTarget(selected, "reconciliation");
    expect((await pool.query<{ input: ReflectionInput }>("SELECT input FROM reflection_runs WHERE id=$1", [reflectionId])).rows[0]?.input.targetSnapshots?.reconciliation?.memories.map(({ id }) => id)).toEqual(selected.memories.map(({ id }) => id));
    await repository.commitTarget({ ...selected, memories: [anchor] }, "reconciliation", { output: { changes: [{ operation: "keep", reason: "後続Eventでも矛盾しない" }] }, toolExecutions: [{ callId: "reconciliation-tool-1", runId: reflectionId, eventId: reflectionId, name: "memory_search", input: { query: anchor.summary }, ok: true, result: { memories: [] }, startedAt: fixtureInstant, finishedAt: fixtureInstant }] });
    expect((await pool.query<{ status: string }>("SELECT status FROM reflection_attempts WHERE reflection_id=$1 AND target='reconciliation'", [reflectionId])).rows[0]?.status).toBe("pending");
    expect((await pool.query<{ anchor_memory_id: string; tool: string }>("SELECT anchor_memory_id,tool FROM reflection_tool_executions WHERE reflection_id=$1", [reflectionId])).rows).toEqual([{ anchor_memory_id: anchor.id, tool: "memory_search" }]);
    await repository.completeTarget(selected, "reconciliation");
    expect((await pool.query<{ status: string }>("SELECT status FROM reflection_attempts WHERE reflection_id=$1 AND target='reconciliation'", [reflectionId])).rows[0]?.status).toBe("completed");
  });

  it("C-10, C-55, FR-10, FR-57: commits only the Memory Reflector's selected evidence from a 32 Event Session", async () => {
    const agentId = "reflection-memory-evidence-agent";
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ($1,'family','Evidence Agent','Careful')", [agentId]);
    await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,relationships,mood) VALUES ($1,'Careful','Evidence story','[]','[]','Calm')", [agentId]);
    const eventIds = Array.from({ length: 32 }, (_, index) => `reflection-evidence-event-${String(index + 1).padStart(2, "0")}`);
    for (const [index, eventId] of eventIds.entries()) { const occurredAt = new Date(Date.UTC(2026, 2, 1, 0, index, 0)); const summary = index === 2 ? "ユーザーは展示を訪れる予定を話した" : `経験 ${String(index + 1)}`; await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ($1,$2,'user-message',$3,'test','completed',$4)", [eventId, agentId, { summary }, occurredAt]); await recordExperience(eventId, summary); }
    const repository = new PostgresReflectionRepository(createRuntimeDatabase(pool), new SequenceIdGenerator(["reflection-memory-evidence-resolution", "reflection-memory-evidence-id"]), () => new Date("2026-03-02T00:00:00Z"));
    const input = await repository.load("reflection-memory-evidence", agentId); if (input === undefined) throw new Error("Reflection input was not created");
    expect(input.events).toHaveLength(32);
    await repository.beginTarget(input, "memory");
    await repository.commitTarget(input, "memory", {
      output: {
        memories: [{
          content: "ユーザーは展示を訪れる予定を話した",
          reason: "次回に訪問できたか尋ねるため",
          target: "episodic",
          perspective: "user"
        }]
      },
      toolExecutions: []
    });
    expect((await pool.query<{ evidence_event_ids: string[] }>("SELECT evidence_event_ids FROM memories WHERE id='reflection-memory-evidence-id'")).rows[0]?.evidence_event_ids).toEqual([eventIds[2]]);
    expect((await pool.query<{ intent: { evidenceEventIds: string[]; confidence: string; purpose: string } }>("SELECT intent FROM memory_mutations WHERE agent_id=$1 AND source_kind='reflection-formation' AND source_id='reflection-memory-evidence'", [agentId])).rows[0]?.intent).toMatchObject({ evidenceEventIds: [eventIds[2]], confidence: "medium", purpose: "user-context" });
  });

  it("FR-71: persists and resumes four 16 Event Formation batches without duplicating their writes", async () => {
    const agentId = "reflection-memory-batch-agent";
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ($1,'family','Batch Agent','Careful')", [agentId]);
    await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,relationships,mood) VALUES ($1,'Careful','Batch story','[]','[]','Calm')", [agentId]);
    const eventIds = Array.from({ length: 64 }, (_, index) => `reflection-batch-event-${String(index + 1).padStart(2, "0")}`);
    for (const [index, eventId] of eventIds.entries()) { const occurredAt = new Date(Date.UTC(2026, 2, 3, 0, index, 0)); const summary = `batch experience ${String(index + 1)}`; await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ($1,$2,'user-message',$3,'test','completed',$4)", [eventId, agentId, { summary }, occurredAt]); await recordExperience(eventId, summary); }
    const repository = new PostgresReflectionRepository(createRuntimeDatabase(pool), new SequenceIdGenerator(["memory-batch-resolution-0", "memory-batch-0", "memory-batch-resolution-1", "memory-batch-1", "memory-batch-resolution-2", "memory-batch-2", "memory-batch-resolution-3", "memory-batch-3"]), () => new Date("2026-03-04T00:00:00Z"));
    const input = await repository.load("reflection-memory-batches", agentId); if (input === undefined) throw new Error("Reflection input was not created");
    expect(input.events).toHaveLength(64);
    await repository.beginTarget(input, "memory");
    const batches = await repository.memoryBatches(input);
    expect(batches.map(({ events }) => events)).toHaveLength(4);
    expect(batches.map(({ events }) => events.length)).toEqual([16, 16, 16, 16]);
    for (const batch of batches) {
      await repository.beginMemoryBatch(input, batch);
      await repository.commitMemoryBatch(input, batch, { output: { memories: [{ content: `batch experience ${String(batch.batchIndex * 16 + 1)}`, reason: "batch evidence", target: "episodic", perspective: "self" }] }, toolExecutions: [] });
    }
    await repository.completeMemoryTarget(input);
    const firstBatch = batches[0]; if (firstBatch === undefined) throw new Error("first batch was not created");
    expect(await repository.beginMemoryBatch(input, firstBatch)).toBe("completed");
    const persistedBatches = (await pool.query<{ batch_index: number; status: string; input: { eventIds: string[] } }>("SELECT batch_index,status,input FROM reflection_memory_batches WHERE reflection_id='reflection-memory-batches' ORDER BY batch_index")).rows;
    expect(persistedBatches.map(({ batch_index, status, input: batchInput }) => ({ batchIndex: batch_index, status, eventCount: batchInput.eventIds.length }))).toEqual([0, 1, 2, 3].map((batchIndex) => ({ batchIndex, status: "completed", eventCount: 16 })));
    expect(persistedBatches.every(({ input: batchInput }) => !("events" in batchInput))).toBe(true);
    const mutations = (await pool.query<{ source_id: string; source_event_id: string | null; intent: { evidenceEventIds: string[] } }>("SELECT source_id,source_event_id,intent FROM memory_mutations WHERE agent_id=$1 AND source_kind='reflection-formation' ORDER BY source_id", [agentId])).rows;
    expect(mutations).toHaveLength(4);
    for (const [batchIndex, mutation] of mutations.entries()) {
      expect(mutation.source_id).toBe(`reflection-memory-batches:memory:${String(batchIndex)}`);
      expect(mutation.source_event_id).toBeNull();
      const evidence = mutation.intent.evidenceEventIds;
      const batchEventIds = eventIds.slice(batchIndex * 16, (batchIndex + 1) * 16);
      expect(evidence).toContain(eventIds[batchIndex * 16]);
      expect(evidence).toHaveLength(16);
      expect(evidence.every((eventId) => batchEventIds.includes(eventId))).toBe(true);
    }
  });

  it("FR-91, NFR-8: records an ignored peer observation without a Run or Projection", async () => {
    const persistence = new PostgresRuntimePersistence(createRuntimeDatabase(pool), () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    const message = messageFixture({ id: "gate-ignore-message", destination: "agent:a" });
    const event = { id: "gate-ignore-event", agentId: "a", kind: "message-received" as const, occurredAt: fixtureInstant, payload: { text: "独り言", senderKind: "peer", addressing: "observed", peerName: "aka", subjectId: "agent:aka" } };
    await expect(persistence.recordIgnoredObservation(message, event, { decision: "ignore", reason: "関心と接続しない", input: { text: "独り言", peerName: "aka", self: { disposition: "気まま", story: "寄り道を好む" }, mood: "退屈している", concerns: [], memories: [] }, modelCalls: 1, retrievalCount: 1 }, ["agent:aka"])).resolves.toBe("committed");
    await expect(persistence.recordIgnoredObservation(message, event, { decision: "ignore", reason: "duplicate", modelCalls: 1, retrievalCount: 0 }, ["agent:aka"])).resolves.toBe("duplicate");
    expect((await pool.query<{ status: string }>("SELECT status FROM events WHERE id='gate-ignore-event'")).rows).toEqual([{ status: "completed" }]);
    expect((await pool.query("SELECT 1 FROM agent_runs WHERE event_id='gate-ignore-event'")).rowCount).toBe(0);
    expect((await pool.query<{ decision: string; retrieval_count: number; text: string }>("SELECT decision,retrieval_count,input->>'text' AS text FROM observation_gate_decisions WHERE event_id='gate-ignore-event'")).rows).toEqual([{ decision: "ignore", retrieval_count: 1, text: "独り言" }]);
    expect((await pool.query("SELECT 1 FROM event_projections WHERE event_id='gate-ignore-event'")).rowCount).toBe(0);
  });

  it("FR-94, NFR-8, NFR-17: commits an Agent-owned Goal and resolves a persisted Discord reply after restart", async () => {
    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const input = agentCoreInputFixture(); input.run = { runId: "conversation-run", eventId: "conversation-event", agentId: "a", occurredAt: fixtureInstant }; input.currentSelf = { ...input.currentSelf, agentId: "a", version }; input.state = { ...input.state, agentId: "a" }; input.conversation = { goal: "失敗差が時間帯と実行者のどちらに由来するか確かめる", status: "candidate" };
    const persistence = new PostgresRuntimePersistence(createRuntimeDatabase(pool), () => Promise.resolve(input), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    const message = messageFixture({ id: "conversation-message", destination: "agent:a" });
    const event = { id: "conversation-event", agentId: "a", kind: "message-received" as const, occurredAt: fixtureInstant, correlationId: "conversation-1", payload: { text: "時間帯で違うと思う", senderKind: "peer", addressing: "observed", replyContext: { channelId: "channel", messageId: "discord-inbound-1" } } };
    const result = { output: { desire: "差の原因を尋ねる", action: { type: "respond" as const, content: "実行者の差は切り分けた？" } }, toolExecutions: [] };
    await expect(persistence.commit(message, event, input, result, { state: input.state, changes: [], concernActivities: [] }, [messageFixture({ id: "conversation-outbox", destination: "discord", payload: { type: "agent-response", text: "実行者の差は切り分けた？", replyContext: { channelId: "channel", messageId: "discord-inbound-1" } } })], [], { decision: "engage", reason: "原因の帰属が気になった", conversationGoal: input.conversation.goal, modelCalls: 1, retrievalCount: 1 })).resolves.toBe("committed");
    const repository = new PostgresConversationRepository(createRuntimeDatabase(pool));
    await repository.registerOutbound("a", "discord-outbound-1", "conversation-1");
    await expect(new PostgresConversationRepository(createRuntimeDatabase(pool)).resolve("a", "discord-outbound-1")).resolves.toEqual({ correlationId: "conversation-1", conversationId: "a:conversation-1" });
    await repository.registerOutbound("a", "discord-monologue-1", "autonomous-correlation-1");
    await expect(new PostgresConversationRepository(createRuntimeDatabase(pool)).resolve("a", "discord-monologue-1")).resolves.toEqual({ correlationId: "autonomous-correlation-1" });

    const seedVersion = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const seedInput = agentCoreInputFixture(); seedInput.run = { runId: "conversation-seed-run", eventId: "conversation-seed-event", agentId: "a", occurredAt: fixtureInstant }; seedInput.currentSelf = { ...seedInput.currentSelf, agentId: "a", version: seedVersion }; seedInput.state = { ...seedInput.state, agentId: "a" }; seedInput.conversation = { goal: "独り言への反応から相手の見方を確かめる", status: "candidate" };
    const seedEvent = { ...event, id: "conversation-seed-event", correlationId: "autonomous-correlation-1", payload: { ...event.payload, replyContext: { channelId: "channel", messageId: "discord-seed-inbound-1" } } };
    await expect(persistence.commit(messageFixture({ id: "conversation-seed-message", destination: "agent:a" }), seedEvent, seedInput, { output: { desire: "相手の見方を一つ尋ねる", action: { type: "respond", content: "どこが一番変だと思った？" } }, toolExecutions: [] }, { state: seedInput.state, changes: [], concernActivities: [] }, [messageFixture({ id: "conversation-seed-outbox", destination: "discord", payload: { type: "agent-response", text: "どこが一番変だと思った？", replyContext: { channelId: "channel", messageId: "discord-seed-inbound-1" } } })])).resolves.toBe("committed");
    await expect(repository.resolve("a", "discord-monologue-1")).resolves.toEqual({ correlationId: "autonomous-correlation-1", conversationId: "a:autonomous-correlation-1" });
    const seedCloseVersion = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const seedCloseInput = agentCoreInputFixture(); seedCloseInput.run = { runId: "conversation-seed-close-run", eventId: "conversation-seed-close-event", agentId: "a", occurredAt: fixtureInstant }; seedCloseInput.currentSelf = { ...seedCloseInput.currentSelf, agentId: "a", version: seedCloseVersion }; seedCloseInput.state = { ...seedCloseInput.state, agentId: "a" }; seedCloseInput.conversation = { goal: seedInput.conversation.goal, status: "active" };
    await expect(persistence.commit(messageFixture({ id: "conversation-seed-close-message", destination: "agent:a" }), { ...seedEvent, id: "conversation-seed-close-event", payload: { ...seedEvent.payload, replyContext: { channelId: "channel", messageId: "discord-seed-inbound-2" } } }, seedCloseInput, { output: { desire: "会話を終える", action: { type: "no-external-action", reason: "見方を得て目的を満たした" } }, toolExecutions: [] }, { state: seedCloseInput.state, changes: [], concernActivities: [] }, [])).resolves.toBe("committed");
    await expect(repository.resolve("a", "discord-monologue-1")).resolves.toBeUndefined();
    await expect(repository.resolve("a", "discord-inbound-1")).resolves.toBeUndefined();
    expect((await pool.query<{ agent_id: string; id: string; goal: string; status: string }>("SELECT agent_id,id,goal,status FROM conversations WHERE agent_id='a' AND id='a:conversation-1'")).rows).toEqual([{ agent_id: "a", id: "a:conversation-1", goal: input.conversation.goal, status: "active" }]);
    expect((await pool.query<{ conversation_goal: string }>("SELECT conversation_goal FROM observation_gate_decisions WHERE event_id='conversation-event'")).rows).toEqual([{ conversation_goal: input.conversation.goal }]);

    const bVersion = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='b'")).rows[0]?.version ?? 0;
    const bInput = agentCoreInputFixture(); bInput.run = { runId: "conversation-run-b", eventId: "conversation-event-b", agentId: "b", occurredAt: fixtureInstant }; bInput.currentSelf = { ...bInput.currentSelf, agentId: "b", version: bVersion }; bInput.state = { ...bInput.state, agentId: "b", concerns: [] }; bInput.conversation = { goal: "同じ発話から別の仮説を確かめる", status: "candidate" };
    const bPersistence = new PostgresRuntimePersistence(createRuntimeDatabase(pool), () => Promise.resolve(bInput), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    await expect(bPersistence.commit(messageFixture({ id: "conversation-message-b", destination: "agent:b" }), { ...event, id: "conversation-event-b", agentId: "b" }, bInput, result, { state: bInput.state, changes: [], concernActivities: [] }, [messageFixture({ id: "conversation-outbox-b", destination: "discord", payload: { type: "agent-response", text: "実行者の差は切り分けた？", replyContext: { channelId: "channel", messageId: "discord-inbound-1" } } })])).resolves.toBe("committed");
    expect((await pool.query<{ agent_id: string; id: string }>("SELECT agent_id,id FROM conversations WHERE id IN ('a:conversation-1','b:conversation-1') ORDER BY agent_id")).rows).toEqual([{ agent_id: "a", id: "a:conversation-1" }, { agent_id: "b", id: "b:conversation-1" }]);

    const closeVersion = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const closeInput = agentCoreInputFixture(); closeInput.run = { runId: "conversation-close-run", eventId: "conversation-close-event", agentId: "a", occurredAt: fixtureInstant }; closeInput.currentSelf = { ...closeInput.currentSelf, agentId: "a", version: closeVersion }; closeInput.state = { ...closeInput.state, agentId: "a" }; closeInput.conversation = { goal: input.conversation.goal, status: "active" };
    await expect(persistence.commit(messageFixture({ id: "conversation-close-message", destination: "agent:a" }), { ...event, id: "conversation-close-event", payload: { ...event.payload, replyContext: { channelId: "channel", messageId: "discord-inbound-2" } } }, closeInput, { output: { desire: "これ以上続けない", action: { type: "no-external-action", reason: "問いへの答えが得られ、追加の差分がない" } }, toolExecutions: [] }, { state: closeInput.state, changes: [], concernActivities: [] }, [])).resolves.toBe("committed");
    const completedConversation = (await pool.query<{ status: string; ended_reason: string; completed_at: Date | null }>("SELECT status,ended_reason,completed_at FROM conversations WHERE id='a:conversation-1'")).rows[0];
    expect(completedConversation?.status).toBe("completed");
    expect(completedConversation?.ended_reason).toBe("問いへの答えが得られ、追加の差分がない");
    expect(completedConversation?.completed_at).toBeInstanceOf(Date);
    await expect(repository.resolve("a", "discord-outbound-1")).resolves.toBeUndefined();

    const refuseVersion = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const refuseInput = agentCoreInputFixture(); refuseInput.run = { runId: "conversation-refuse-run", eventId: "conversation-refuse-event", agentId: "a", occurredAt: fixtureInstant }; refuseInput.currentSelf = { ...refuseInput.currentSelf, agentId: "a", version: refuseVersion }; refuseInput.state = { ...refuseInput.state, agentId: "a" };
    const refuseEvent = { ...event, id: "conversation-refuse-event", correlationId: "conversation-refuse" };
    await expect(persistence.commit(messageFixture({ id: "conversation-refuse-message", destination: "agent:a" }), refuseEvent, refuseInput, { output: { desire: "境界を明確に断る", action: { type: "refuse", content: "それは引き受けない。", reason: "自分の価値に反する", basis: "personality" } }, toolExecutions: [] }, { state: refuseInput.state, changes: [], concernActivities: [] }, [messageFixture({ id: "conversation-refuse-outbox", destination: "discord", payload: { type: "agent-response", text: "それは引き受けない。", replyContext: { channelId: "channel", messageId: "discord-inbound-refuse" } } })])).resolves.toBe("committed");
    expect((await pool.query<{ goal: string; status: string }>("SELECT goal,status FROM conversations WHERE id='a:conversation-refuse'")).rows).toEqual([{ goal: "境界を明確に断る", status: "active" }]);

    const channelVersion = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const channelInput = agentCoreInputFixture(); channelInput.run = { runId: "conversation-channel-run", eventId: "conversation-channel-event", agentId: "a", occurredAt: fixtureInstant }; channelInput.currentSelf = { ...channelInput.currentSelf, agentId: "a", version: channelVersion }; channelInput.state = { ...channelInput.state, agentId: "a" }; channelInput.conversation = { goal: "独り言を共有する", status: "candidate" };
    const channelEvent = { ...event, id: "conversation-channel-event", correlationId: "conversation-channel" };
    await expect(persistence.commit(messageFixture({ id: "conversation-channel-message", destination: "agent:a" }), channelEvent, channelInput, { output: { desire: "自分の発見を独り言にする", action: { type: "respond", recipient: "channel", content: "この差、妙だな。" } }, toolExecutions: [] }, { state: channelInput.state, changes: [], concernActivities: [] }, [messageFixture({ id: "conversation-channel-outbox", destination: "discord", payload: { type: "agent-response", text: "この差、妙だな。", replyContext: { channelId: "channel" } } })])).resolves.toBe("committed");
    expect((await pool.query("SELECT 1 FROM conversations WHERE id='a:conversation-channel'")).rowCount).toBe(0);
  });

  it("FR-91: builds a bounded Self- and Mood-aware Observation Gate view from persistent state", async () => {
    await pool.query("UPDATE agent_states SET disposition=$2,self_story=$3,mood=$4,relationships=$5 WHERE agent_id=$1", ["b", "気ままで好奇心が強い", "食い違いを見つけると首を突っ込みたくなる", "退屈していて刺激が欲しい", JSON.stringify([{ subjectId: "agent:aka", description: "議論すると張り合いたくなる相手" }])]);
    await setConcerns("b", [{ id: "hidden-concern-id", status: "active", description: "噂が変質する仕組み", whyItMatters: "食い違いが気になる" }]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('gate-prior-event','b','message-received',$1,'test','completed','2026-11-20T00:00:00.000Z')", [JSON.stringify({ summary: "akaの観測投稿", facts: [] })]);
    await pool.query("INSERT INTO event_subjects(event_id,subject_id) VALUES ('gate-prior-event','agent:aka')");
    await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,result,started_at,finished_at) VALUES ('gate-prior-run','b','gate-prior-event',0,$1,'2026-11-20T00:00:00.000Z','2026-11-20T00:00:00.000Z')", [JSON.stringify({ output: { action: { type: "respond", content: "前に自分が言ったこと" } } })]);
    for (const index of [1, 2, 3, 4]) {
      await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ($1,'b','message-received',$2,'test','completed',$3)", [`gate-silent-event-${String(index)}`, JSON.stringify({ summary: "akaの続報", facts: [] }), `2026-11-20T00:00:0${String(index)}.000Z`]);
      await pool.query("INSERT INTO event_subjects(event_id,subject_id) VALUES ($1,'agent:aka')", [`gate-silent-event-${String(index)}`]);
      await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,result,started_at,finished_at) VALUES ($1,'b',$2,0,$3,$4,$4)", [`gate-silent-run-${String(index)}`, `gate-silent-event-${String(index)}`, JSON.stringify({ output: { action: { type: "no-external-action", reason: "新しい問いがない" } } }), `2026-11-20T00:00:0${String(index)}.000Z`]);
    }
    const retrieval = { retrieve: () => Promise.resolve([{ source: "conversation" as const, id: "hidden-memory-id", kind: "episodic", content: "以前akaと出典について言い合った", occurredAt: fixtureInstant, importance: "medium", matchedBy: ["subject" as const], finalRank: 1 }]) };
    const context = new PostgresObservationGateContext(createRuntimeDatabase(pool), retrieval);
    const input = await context.load({ id: "hidden-event-id", agentId: "b", kind: "message-received", occurredAt: fixtureInstant, payload: { text: "噂の出典がまた変わった", senderKind: "peer", addressing: "observed", peerName: "aka", subjectId: "agent:aka" } }, new AbortController().signal);
    expect(input).toEqual({ text: "噂の出典がまた変わった", peerName: "aka", self: { disposition: "気ままで好奇心が強い", story: "食い違いを見つけると首を突っ込みたくなる" }, mood: "退屈していて刺激が欲しい", relationship: "議論すると張り合いたくなる相手", concerns: ["噂が変質する仕組み"], memories: ["以前akaと出典について言い合った"], recentSelfSpeech: "前に自分が言ったこと" });
    expect(JSON.stringify(input)).not.toContain("hidden-");
    expect(JSON.stringify(input)).not.toContain("gate-prior-");
    expect(JSON.stringify(input)).not.toContain("gate-silent-");
    await pool.query("DELETE FROM agent_runs WHERE id LIKE 'gate-silent-run-%'");
    await pool.query("DELETE FROM events WHERE id LIKE 'gate-silent-event-%'");
    await pool.query("DELETE FROM agent_runs WHERE id='gate-prior-run'");
    await pool.query("DELETE FROM events WHERE id='gate-prior-event'");
    await pool.query("UPDATE agent_states SET disposition='Careful learner',self_story='Growing continuously',mood='Calm',relationships='[]' WHERE agent_id='b'");
    await setConcerns("b", []);
  });

  it("FR-91, NFR-8: claims an observed peer post once across Runtime instances and releases a failed claim", async () => {
    const first = new PostgresRuntimePersistence(createRuntimeDatabase(pool), () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    const second = new PostgresRuntimePersistence(createRuntimeDatabase(pool), () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    await expect(first.claimObservationGate("agent:a", "gate-claim-message")).resolves.toBe(true);
    await expect(second.claimObservationGate("agent:a", "gate-claim-message")).resolves.toBe(false);
    await first.releaseObservationGate("agent:a", "gate-claim-message");
    await expect(second.claimObservationGate("agent:a", "gate-claim-message")).resolves.toBe(true);
  });

  it("FR-15, NFR-8: records Tool side effects when final Agent output fails without marking the message complete", async () => {
    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const input = agentCoreInputFixture();
    input.run = { runId: "failed-run", eventId: "failed-event", agentId: "a", occurredAt: fixtureInstant };
    input.currentSelf = { ...input.currentSelf, agentId: "a", version }; input.state = { ...input.state, agentId: "a" };
    input.availableTools = [{ name: "lookup", description: "Lookup", inputSchema: {} }];
    const persistence = new PostgresRuntimePersistence(createRuntimeDatabase(pool), () => Promise.resolve(input), new SequenceIdGenerator(["failed-tool-record"]), () => new Date(fixtureInstant));
    const message = messageFixture({ id: "failed-message", destination: "agent:a" });
    const event = { id: "failed-event", agentId: "a", kind: "user-message" as const, occurredAt: fixtureInstant, payload: { text: "hello" } };
    await persistence.recordFailure(message, event, input, new Error("invalid final output"), [{ callId: "tool-1", runId: "failed-run", eventId: "failed-event", name: "lookup", input: { q: "x" }, ok: true, result: { answer: 1 }, startedAt: fixtureInstant, finishedAt: fixtureInstant }]);
    expect((await pool.query<{ failure_reason: string }>("SELECT failure_reason FROM agent_runs WHERE id='failed-run'")).rows[0]?.failure_reason).toContain("invalid final output");
    expect((await pool.query<{ input_snapshot: { run: { runId: string }; observation: { summary: string } } }>("SELECT input_snapshot FROM agent_runs WHERE id='failed-run'")).rows[0]?.input_snapshot).toMatchObject({ run: { runId: "failed-run" }, observation: { summary: input.observation.summary } });
    expect((await pool.query("SELECT 1 FROM tool_executions WHERE id='failed-tool-record'")).rowCount).toBe(1);
    expect((await pool.query("SELECT 1 FROM message_receipts WHERE message_id='failed-message'")).rowCount).toBe(0);
  });
});
