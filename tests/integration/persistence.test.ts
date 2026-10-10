import { mkdtemp, readFile, rm } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { parse } from "dotenv";
import { Pool } from "pg";
import { z } from "zod";

import { AgentStateRepository, PostgresUnitOfWork, migrate, withAgentLock } from "../../src/infrastructure/persistence/postgres.js";
import { PostgresEventTransaction } from "../../src/infrastructure/persistence/event-transaction.js";
import { messageFixture } from "../../src/testing/contract-fixtures.js";
import { PostgresMemoryRetriever } from "../../src/infrastructure/persistence/postgres-memory-retriever.js";
import { PostgresScheduleRepository } from "../../src/infrastructure/persistence/postgres-schedule-repository.js";
import { PostgresLongTermReviewRepository } from "../../src/infrastructure/persistence/postgres-long-term-review.js";
import { LongTermReviewService } from "../../src/application/long-term-review.js";
import { PostgresRuntimePersistence } from "../../src/infrastructure/persistence/postgres-runtime-persistence.js";
import { SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { agentCoreInputFixture, fixtureInstant } from "../../src/testing/contract-fixtures.js";
import { PostgresAgentContextLoader } from "../../src/infrastructure/persistence/postgres-agent-context-loader.js";
import { FakeEmbeddingProvider } from "../../src/infrastructure/embedding/ollama-embedding.js";
import { ToolRegistry } from "../../src/application/tool-registry.js";
import { BotHost } from "../../src/bootstrap/bot-host.js";
import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";
import { PostgresMemoryEmbeddingLifecycle } from "../../src/infrastructure/persistence/postgres-memory-embedding.js";
import { PostgresWebArchive } from "../../src/infrastructure/persistence/postgres-web-archive.js";
import { createWebTools } from "../../src/infrastructure/tools/web-tools.js";
import { initializeAgent } from "../../src/operations/operations.js";

const sample = parse(await readFile(new URL("../../.env.sample", import.meta.url)));
const databaseUrl = (process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL ?? sample.POSTGRES_URL)?.replace("postgresql+psycopg://", "postgresql://");
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

describeDatabase("PostgreSQL persistence", () => {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const control = new Pool({ connectionString: databaseUrl, max: 2 });
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public,ext`, max: 4 });

  beforeAll(async () => {
    await control.query(`CREATE SCHEMA ${schema}`);
    await migrate(pool);
    await migrate(pool);
    await pool.query("INSERT INTO agent_families(id,name,shared_disposition,base_instruction) VALUES ('family','Family','Curious','Help')");
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ('a','family','Agent A','Calm'),('b','family','Agent B','Bold')");
    for (const agentId of ["a", "b"]) await pool.query("INSERT INTO agent_states(agent_id,acquired_disposition,values,roles,self_narrative,self_continuity,mood,drives) VALUES ($1,'Learning','Care','[\"Helper\"]','Growing','Continuous','Calm',$2)", [agentId, JSON.stringify([{ description: "Learn", sourceEvidenceIds: [], since: fixtureInstant }])]);
    await migrate(pool);
  });
  afterAll(async () => {
    await pool.end();
    await control.query(`DROP SCHEMA ${schema} CASCADE`);
    await control.end();
  });

  it("round-trips isolated agent state and rejects stale versions", async () => {
    const repository = new AgentStateRepository(pool);
    expect((await repository.find<{ agent_id: string }>("a"))?.agent_id).toBe("a");
    expect(await repository.find("missing")).toBeUndefined();
    await expect(repository.update("a", 0, { mood: "Focused" })).resolves.toBe(1);
    await expect(repository.update("a", 0, { mood: "Stale" })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await repository.find<{ mood: string }>("b"))?.mood).toBe("Calm");
    expect((await repository.find<{ roles: string[]; drives: { description: string }[] }>("a"))).toMatchObject({ roles: ["Helper"], drives: [{ description: "Learn" }] });
  });

  it("initializes configured Self and preserves acquired experience on reapply", async () => {
    const config = {
      version: 1 as const,
      family: { id: "configured-family", name: "Configured", sharedDisposition: "共通傾向", baseInstruction: "根拠を区別する" },
      agent: { id: "configured-agent", identity: "Configured Agent", initialDisposition: "初期個体差", values: "初期価値", interests: ["最初の関心"], preferences: [], roles: ["対話相手"], selfNarrative: "始まったばかり", selfContinuity: "経験をつなぐ" },
      initialState: { mood: "中立", drives: [], currentInterests: [] }
    };
    const initialTimings = { autonomyReviewIntervalMs: 2_000, stateReviewIntervalMs: 3_000, memoryRecallIntervalMs: 4_000 };
    await initializeAgent(pool, config, initialTimings);
    expect((await pool.query<{ kind: string }>("SELECT kind FROM autonomous_schedules WHERE agent_id=$1 AND kind='autonomy-review'", [config.agent.id])).rows).toEqual([{ kind: "autonomy-review" }]);
    expect((await pool.query<{ kind: string; delay_ms: number }>("SELECT kind,round(extract(epoch FROM (next_due_at-updated_at))*1000)::int AS delay_ms FROM autonomous_schedules WHERE agent_id=$1 ORDER BY kind", [config.agent.id])).rows).toEqual([{ kind: "autonomy-review", delay_ms: 2_000 }, { kind: "memory-recall", delay_ms: 4_000 }, { kind: "state-review", delay_ms: 3_000 }]);
    await pool.query("UPDATE agent_states SET acquired_disposition='経験で得た傾向', values='経験で変化した価値', mood='持続する気分', drives=$2 WHERE agent_id=$1", [config.agent.id, JSON.stringify([{ description: "継続中のDrive", sourceEvidenceIds: [], since: fixtureInstant }])]);
    await pool.query("INSERT INTO social_contexts(id,agent_id,subject_id,subject_type,description) VALUES ('configured-social',$1,'owner','user','継続する関係')", [config.agent.id]);
    await initializeAgent(pool, { ...config, agent: { ...config.agent, values: "再適用値" } }, initialTimings);
    const loaded = await pool.query<{ shared_disposition: string; initial_disposition: string; acquired_disposition: string; values: string; mood: string; drives: unknown }>("SELECT f.shared_disposition,a.initial_disposition,s.acquired_disposition,s.values,s.mood,s.drives FROM agents a JOIN agent_families f ON f.id=a.family_id JOIN agent_states s ON s.agent_id=a.id WHERE a.id=$1", [config.agent.id]);
    expect(loaded.rows[0]).toMatchObject({ shared_disposition: "共通傾向", initial_disposition: "初期個体差", acquired_disposition: "経験で得た傾向", values: "経験で変化した価値", mood: "持続する気分", drives: [{ description: "継続中のDrive" }] });
    expect((await pool.query("SELECT 1 FROM social_contexts WHERE id='configured-social'")).rowCount).toBe(1);
    await initializeAgent(pool, { ...config, family: { ...config.family, sharedDisposition: "更新した共通傾向" }, agent: { ...config.agent, values: "明示的な設定値", interests: ["更新した関心"], preferences: ["更新した好み"] } }, initialTimings, { overwriteConfiguredSelf: true });
    const overwritten = await pool.query<{ shared_disposition: string; acquired_disposition: string; values: string; interests: string[]; preferences: string[]; mood: string; drives: unknown; version: number }>("SELECT f.shared_disposition,s.acquired_disposition,s.values,s.interests,s.preferences,s.mood,s.drives,s.version FROM agents a JOIN agent_families f ON f.id=a.family_id JOIN agent_states s ON s.agent_id=a.id WHERE a.id=$1", [config.agent.id]);
    expect(overwritten.rows[0]).toMatchObject({ shared_disposition: "更新した共通傾向", acquired_disposition: "経験で得た傾向", values: "明示的な設定値", interests: ["更新した関心"], preferences: ["更新した好み"], mood: "持続する気分", drives: [{ description: "継続中のDrive" }], version: 1 });
    expect((await pool.query("SELECT 1 FROM social_contexts WHERE id='configured-social'")).rowCount).toBe(1);
  });

  it("rolls back event and outbox as one unit", async () => {
    const unit = new PostgresUnitOfWork(pool);
    await expect(unit.transaction(async (client) => {
      await client.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('event-rollback','a','internal','{}','test','processing',now())");
      await client.query("INSERT INTO outbox_messages(id,agent_id,envelope) VALUES ('outbox-rollback','a','{}')");
      throw new Error("stop");
    })).rejects.toThrow("stop");
    expect((await pool.query("SELECT id FROM events WHERE id='event-rollback'")).rowCount).toBe(0);
    expect((await pool.query("SELECT id FROM outbox_messages WHERE id='outbox-rollback'")).rowCount).toBe(0);
  });

  it("serializes an agent advisory lock and releases it", async () => {
    let release!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const first = withAgentLock(pool, 4242, () => held);
    await new Promise((resolve) => setTimeout(resolve, 25));
    await expect(withAgentLock(pool, 4242, () => Promise.resolve(undefined))).rejects.toMatchObject({ code: "CONFLICT" });
    release(); await first;
    await expect(withAgentLock(pool, 4242, () => Promise.resolve("ok"))).resolves.toBe("ok");
  });

  it("commits receipt, event, state trace and outbox atomically and deduplicates", async () => {
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

  it("leaves no partial records after a version conflict", async () => {
    const transaction = new PostgresEventTransaction(new PostgresUnitOfWork(pool));
    await expect(transaction.commit({
      destination: "agent:a", messageId: "incoming-conflict",
      event: { id: "event-conflict", agentId: "a", kind: "internal", observation: {}, source: "test", occurredAt: new Date() },
      run: { id: "run-conflict", inputStateVersion: 0, startedAt: new Date(), result: {} }, stateValues: { mood: "Wrong" }, changes: [], outbox: []
    })).rejects.toMatchObject({ code: "CONFLICT" });
    expect((await pool.query("SELECT 1 FROM message_receipts WHERE message_id='incoming-conflict'")).rowCount).toBe(0);
    expect((await pool.query("SELECT 1 FROM events WHERE id='event-conflict'")).rowCount).toBe(0);
  });

  it("combines lexical and vector retrieval with filters and agent isolation", async () => {
    const unit = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const opposite = Array.from({ length: 768 }, (_, index) => index === 1 ? 1 : 0);
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,embedding,embedding_model,embedding_status) VALUES ('memory-a1','a','semantic','typescript architecture','Relevant','2026-01-02',$1::vector,'test','ready'),('memory-a2','a','episodic','unrelated note','Relevant','2026-01-01',$2::vector,'test','ready'),('memory-b1','b','semantic','typescript secret','Relevant','2026-01-03',$1::vector,'test','ready')", [`[${unit.join(",")}]`, `[${opposite.join(",")}]`]);
    const retriever = new PostgresMemoryRetriever(pool);
    const found = await retriever.retrieve("a", { text: "typescript", keywords: ["typescript"], subjectIds: [], kinds: ["semantic"] }, unit, 5);
    expect(found.memories.map(({ id }) => id)).toEqual(["memory-a1"]);
    expect(found.memories.every(({ agentId }) => agentId === "a")).toBe(true);
  });

  it("ranks Japanese keyword, subject, priority and category candidates with a stable fallback", async () => {
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

  it("embeds pending Memory after persistence and backfills failures without crossing Agent ownership", async () => {
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ('embedding-a','family','Embedding A','Calm'),('embedding-b','family','Embedding B','Calm')");
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,embedding_status) VALUES ('embedding-memory-a','embedding-a','episodic','remember a','Relevant',now(),'pending'),('embedding-memory-b','embedding-b','episodic','remember b','Relevant',now(),'pending')");
    const vector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const lifecycle = new PostgresMemoryEmbeddingLifecycle(pool, new FakeEmbeddingProvider({ "remember a": vector, "remember b": vector }), "fake-embed");
    await expect(lifecycle.embedMemoryIds("embedding-a", ["embedding-memory-a", "embedding-memory-b"])).resolves.toEqual({ attempted: 1, ready: 1, failed: 0 });
    expect((await pool.query<{ embedding_status: string; embedding_model: string; embedding_dimension: number }>("SELECT embedding_status,embedding_model,embedding_dimension FROM memories WHERE id='embedding-memory-a'")).rows[0]).toEqual({ embedding_status: "ready", embedding_model: "fake-embed", embedding_dimension: 768 });
    expect((await pool.query<{ embedding_status: string }>("SELECT embedding_status FROM memories WHERE id='embedding-memory-b'")).rows[0]?.embedding_status).toBe("pending");
    await expect(lifecycle.embedMemoryIds("embedding-a", ["embedding-memory-a"])).resolves.toEqual({ attempted: 0, ready: 0, failed: 0 });

    const failing = new PostgresMemoryEmbeddingLifecycle(pool, { dimension: 768, embed: () => Promise.reject(new Error("provider unavailable")) }, "fake-embed");
    await expect(failing.embedMemoryIds("embedding-b", ["embedding-memory-b"])).resolves.toEqual({ attempted: 1, ready: 0, failed: 1 });
    expect((await pool.query<{ embedding_status: string; embedding_error: string }>("SELECT embedding_status,embedding_error FROM memories WHERE id='embedding-memory-b'")).rows[0]).toEqual({ embedding_status: "failed", embedding_error: "provider unavailable" });
    await expect(lifecycle.backfill({ agentId: "embedding-b" })).resolves.toEqual({ attempted: 1, ready: 1, failed: 0 });
  });

  it("archives fetched pages as shared files and supports cross-Bot search and bounded reads", async () => {
    const markdown = "# Vector indexes\n\nHNSW provides fast approximate search."; const changed = `${markdown}\n\nIVFFlat requires training.`;
    const summary = "HNSWによる高速な近似ベクトル検索を説明する記事。"; const changedSummary = "HNSWと、学習を必要とするIVFFlatを比較する記事。";
    const vector = Array.from({ length: 768 }, (_, index) => index === 3 ? 1 : 0);
    const embedding = new FakeEmbeddingProvider({ [summary]: vector, [changedSummary]: vector, "vector search": vector });
    const root = await mkdtemp(join(tmpdir(), "web-archive-"));
    const summarizer = { summarize: (input: { markdown: string }) => Promise.resolve(input.markdown === markdown ? summary : changedSummary) };
    const archive = new PostgresWebArchive(pool, embedding, summarizer, new SequenceIdGenerator(["resource-web", "snapshot-web", "resource-repeat", "resource-changed", "snapshot-changed"]), () => new Date("2026-04-01T00:00:00Z"), "web-fake", root);
    const context = { agentId: "a", runId: "web-run", eventId: "web-event", toolCallId: "tool-1" };
    const pageRegistry = new ToolRegistry(createWebTools("http://web.local", { archive, fetcher: () => Promise.resolve(new Response(JSON.stringify({ docs: [{ url: "https://EXAMPLE.com/article?b=2&a=1#top", title: "Postgres vectors", markdown }] }), { status: 200 })) }));
    const pageResult = await pageRegistry.execute("web_page", { urls: "https://example.com/article" }, { ...context, idempotencyKey: "web-run:tool-1" }, new AbortController().signal);
    const first = (pageResult.value as { documents: { snapshotId: string; url: string; status: string; summary: string }[] }).documents;
    expect(JSON.stringify(pageResult.value)).not.toContain(markdown);
    const repeated = await archive.archivePages([{ url: "https://example.com/article?a=1&b=2", title: "Postgres vectors", markdown }], { ...context, toolCallId: "tool-2" }, new AbortController().signal);
    const latest = await archive.archivePages([{ url: "https://example.com/article?a=1&b=2", title: "Postgres vectors", markdown: changed }], { ...context, toolCallId: "tool-3" }, new AbortController().signal);
    expect(first[0]?.snapshotId).toBe(repeated[0]?.snapshotId); expect(latest[0]?.snapshotId).not.toBe(first[0]?.snapshotId);
    expect((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM web_snapshots")).rows[0]?.count).toBe("2");
    const found = await archive.search("b", { query: "vector search", limit: 5 }, new AbortController().signal);
    expect(found.map(({ snapshotId }) => snapshotId)).toContain(first[0]?.snapshotId);
    expect((await archive.read(first[0]?.snapshotId ?? "", 0, 20)).text.length).toBeLessThanOrEqual(20);
    expect((await archive.grep(first[0]?.snapshotId ?? "", "HNSW")).matches.length).toBeGreaterThan(0);

    const beforeList = (await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM web_snapshots")).rows[0]?.count;
    const registry = new ToolRegistry(createWebTools("http://web.local", { archive, fetcher: () => Promise.resolve(new Response(JSON.stringify({ query: "x", k: 1, results: [{ rank: 1, title: "Candidate", url: "https://example.com", snippet: "x" }] }), { status: 200 })) }));
    await registry.execute("web_list", { q: "x", k: 1 }, { agentId: "a", runId: "list-run", eventId: "list-event", toolCallId: "tool-1", idempotencyKey: "list-run:tool-1" }, new AbortController().signal);
    expect((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM web_snapshots")).rows[0]?.count).toBe(beforeList);

    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const input = agentCoreInputFixture(); input.run = { runId: "archive-memory-run", eventId: "archive-memory-event", agentId: "a", occurredAt: fixtureInstant }; input.self = { ...input.self, id: "a", version }; input.dynamicState = { ...input.dynamicState, agentId: "a" }; input.availableTools = [{ name: "web_archive_read", description: "Archive", inputSchema: {} }];
    const persistence = new PostgresRuntimePersistence(pool, () => Promise.resolve(input), new SequenceIdGenerator(["archive-tool-record", "archive-continuity-job", "archive-memory-job", "archive-memory"]), () => new Date(fixtureInstant), undefined, 0, registry);
    const toolExecution = { callId: "tool-1", runId: "archive-memory-run", eventId: "archive-memory-event", name: "web_archive_read", input: { snapshotId: first[0]?.snapshotId }, ok: true as const, result: { snapshotId: first[0]?.snapshotId, offset: 0, text: "raw page must not enter post-process", truncated: true }, startedAt: fixtureInstant, finishedAt: fixtureInstant };
    const runResult = { output: { interpretation: {}, internalChanges: { immediateStateUpdates: [] }, action: { type: "no-external-action" as const, reason: "Recorded" } }, toolExecutions: [toolExecution] };
    await persistence.commit(messageFixture({ id: "archive-memory-message", destination: "a" }), { id: "archive-memory-event", agentId: "a", kind: "internal", occurredAt: fixtureInstant, payload: {} }, input, runResult, { state: input.dynamicState, changes: [] }, []);
    const archiveJob = await persistence.claimPostProcess("a", "archive-memory-run"); if (archiveJob === undefined) throw new Error("Post-process job was not created");
    expect(JSON.stringify(archiveJob.input)).not.toContain("raw page must not enter post-process");
    expect(JSON.stringify(archiveJob.input)).toContain("textCharacters");
    if (archiveJob.type === "continuity") await persistence.completePostProcess(archiveJob, { persistentStateUpdates: [], driveProposals: [], currentInterestProposals: [] });
    const archiveMemoryJob = archiveJob.type === "memory" ? archiveJob : await persistence.claimPostProcess("a", "archive-memory-run"); if (archiveMemoryJob?.type !== "memory") throw new Error("Memory job was not created");
    await persistence.completePostProcess(archiveMemoryJob, { memoryProposals: [{ content: "Vector index options were investigated", relatedSubjectIds: [], importance: "Useful research", retrievalPriority: "normal", webSnapshotIds: [first[0]?.snapshotId ?? ""] }] });
    expect((await pool.query<{ snapshot_id: string }>("SELECT snapshot_id FROM memory_web_evidence WHERE memory_id='archive-memory'")).rows[0]?.snapshot_id).toBe(first[0]?.snapshotId);
    await rm(root, { recursive: true, force: true });
  });

  it("loads a complete Agent Core context from PostgreSQL without crossing Agent ownership", async () => {
    await pool.query("UPDATE agent_families SET base_instruction='' WHERE id='family'");
    await pool.query("INSERT INTO social_contexts(id,agent_id,subject_id,subject_type,description) VALUES ('social-a','a','owner','user','Trusted'),('social-b','b','owner','user','Private') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO memory_subjects(memory_id,subject_id) VALUES ('memory-a1','owner') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('recent-a','a','user-message',$1,'test','completed','2026-01-01'),('recent-b','b','user-message',$2,'test','completed','2026-01-01')", [JSON.stringify({ eventId: "recent-a", summary: "previous exchange", facts: ["prior context"], observedAt: fixtureInstant }), JSON.stringify({ eventId: "recent-b", summary: "private exchange", facts: ["other agent"], observedAt: fixtureInstant })]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('large-tool-result','a','tool-result',$1,'web_page','completed',now())", [JSON.stringify({ eventId: "large-tool-result", summary: "web_page result", facts: ["tool result"], observedAt: fixtureInstant, content: { markdown: "x".repeat(100_000) } })]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('attempt-event-a','a','internal',$1,'scheduler','completed',now()),('attempt-event-b','b','internal',$2,'scheduler','completed',now())", [JSON.stringify({ eventId: "attempt-event-a", summary: "recent attempt", facts: [], observedAt: new Date().toISOString() }), JSON.stringify({ eventId: "attempt-event-b", summary: "foreign attempt", facts: [], observedAt: new Date().toISOString() })]);
    await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,result,started_at,finished_at) VALUES ('attempt-run-a','a','attempt-event-a',0,$1,now(),now()),('attempt-run-b','b','attempt-event-b',0,$2,now(),now())", [JSON.stringify({ output: { action: { type: "respond", content: "最近、何に関心がありますか？" } } }), JSON.stringify({ output: { action: { type: "respond", content: "private" } } })]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('failed-experience-a','a','internal',$1,'scheduler','failed',now())", [JSON.stringify({ eventId: "failed-experience-a", summary: "failed exploration", facts: [], observedAt: new Date().toISOString(), kind: "internal" })]);
    await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,result,failure_reason,started_at,finished_at) VALUES ('failed-run-a','a','failed-experience-a',0,NULL,'provider timeout',now(),now())");
    await pool.query("INSERT INTO tool_executions(id,run_id,event_id,tool_call_id,tool,input,result,error,started_at,finished_at) VALUES ('failed-tool-a','failed-run-a','failed-experience-a','call-1','web_list',$1,$2,NULL,now(),now())", [JSON.stringify({ q: "agent memory" }), JSON.stringify({ results: [] })]);
    await pool.query("INSERT INTO tool_executions(id,run_id,event_id,tool_call_id,tool,input,result,error,started_at,finished_at) VALUES ('failed-file-tool-a','failed-run-a','failed-experience-a','call-2','file_read',$1,$2,NULL,now(),now())", [JSON.stringify({ path: "notes.md" }), JSON.stringify({ path: "notes.md", content: "raw file must not enter recent experiences", truncated: false })]);
    const vector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const loader = new PostgresAgentContextLoader({
      pool, ids: new SequenceIdGenerator(["context-run", "context-run-2", "context-run-b"]), embedding: new FakeEmbeddingProvider({ hello: vector }), tools: new ToolRegistry([...createWebTools("http://web.local"), { name: "file_read", description: "Read", schema: z.object({}), resultPolicy: { kind: "content-read" as const, defaultRequestCharacters: 2_000, runCharacterBudget: 6_000 }, execute: () => Promise.resolve({ ok: true }) }]),
      persona: { version: 1, identity: { displayName: "Agent A" }, communication: { language: "ja", firstPerson: "僕", tone: ["明るい"], responseStyle: [], avoid: [] } },
      budget: { maxTokens: 10_000, maxMemories: 10, maxSocialContexts: 10 },
      limits: { deadlineMs: 1_000, maxSteps: 4, maxToolCalls: 0, maxHops: 4, maxAttempts: 3 }
    });
    const input = await loader.load({ id: "context-event", agentId: "a", kind: "user-message", occurredAt: fixtureInstant, payload: { text: "hello", transport: { hop: 2, expiresAt: "2026-01-02T00:00:00Z", replyTo: "discord:a" } } });
    expect(input.run).toMatchObject({ runId: "context-run", agentId: "a", transport: { hop: 2, replyTo: "discord:a" } });
    expect(input.self.id).toBe("a");
    expect(input.self.disposition).toEqual({ shared: "Curious", initial: "Calm", acquired: "Learning" });
    expect(input.persona).toMatchObject({ identity: { displayName: "Agent A" }, communication: { firstPerson: "僕" } });
    expect(input.socialContext.map(({ id }) => id)).toContain("social-a");
    expect(input.socialContext.map(({ id }) => id)).not.toContain("social-b");
    expect(input.memories.every(({ agentId }) => agentId === "a")).toBe(true);
    expect(input.memories.find(({ id }) => id === "memory-a1")).toMatchObject({ relatedSubjectIds: ["owner"] });
    expect(input.recentExperiences.map(({ eventId }) => eventId)).toEqual(expect.arrayContaining(["attempt-event-a", "failed-experience-a"]));
    expect(input.recentExperiences.map(({ eventId }) => eventId)).toContain("recent-a");
    expect(input.recentExperiences.map(({ eventId }) => eventId)).not.toContain("recent-b");
    expect(input.recentExperiences.map(({ eventId }) => eventId)).not.toContain("large-tool-result");
    expect(input.recentExperiences.map(({ eventId }) => eventId)).not.toContain("attempt-event-b");
    expect(input.recentExperiences.find(({ eventId }) => eventId === "failed-experience-a")?.steps).toEqual([
      { type: "tool", name: "web_list", input: { q: "agent memory" }, result: { results: [] }, ok: true },
      { type: "tool", name: "file_read", input: { path: "notes.md" }, result: { path: "notes.md", contentCharacters: 42, truncated: false }, ok: true },
      { type: "failure", reason: "provider timeout" }
    ]);
    expect(JSON.stringify(input.recentExperiences)).not.toContain("raw file must not enter recent experiences");
    expect(input.runtimeConstraints.every((value) => value.length > 0)).toBe(true);
    expect(input.runtimeConstraints.join(" ")).not.toContain("Curious");
    expect(input.availableTools.map(({ name }) => name)).toEqual(["web_list", "web_page", "file_read"]);
    const allowed = await loader.load({ id: "context-event-2", agentId: "a", kind: "user-message", occurredAt: fixtureInstant, payload: { text: "hello" } });
    expect(allowed.availableTools.map(({ name }) => name)).toEqual(input.availableTools.map(({ name }) => name));
    const other = await loader.load({ id: "context-event-b", agentId: "b", kind: "user-message", occurredAt: fixtureInstant, payload: { text: "hello" } });
    expect(other.self.disposition).toEqual({ shared: "Curious", initial: "Bold", acquired: "Learning" });
  });

  it("holds one process lock per Agent and drains loops during shutdown", async () => {
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

  it("claims a due Scheduled Task once and records its execution Event", async () => {
    await pool.query("INSERT INTO scheduled_tasks(id,agent_id,execute_at,instruction,status,idempotency_key,source_event_id,source_run_id) VALUES ('task-due','a','2026-01-01','結果を知らせる','scheduled','task-key','source-event','source-run')");
    const first = new PostgresScheduleRepository(pool); const second = new PostgresScheduleRepository(pool);
    const claims = (await Promise.all([first.claimDue(new Date("2026-01-02T00:00:00Z"), 10), second.claimDue(new Date("2026-01-02T00:00:00Z"), 10)])).flat().filter(({ id }) => id === "task-due");
    expect(claims).toEqual([{ id: "task-due", agentId: "a", kind: "scheduled-task", reason: "Scheduled Taskの期限到来", instruction: "結果を知らせる" }]);
    const task = claims[0]; if (task === undefined) throw new Error("Scheduled Task was not claimed");
    await first.complete(task, null, "execution-event");
    expect((await pool.query("SELECT status,attempt,execution_event_id FROM scheduled_tasks WHERE id='task-due'")).rows[0]).toMatchObject({ status: "completed", attempt: 1, execution_event_id: "execution-event" });
  });

  it("shares correlation-loop and rate limits across Runtime instances", async () => {
    const first = new PostgresRuntimePersistence(pool, () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    const second = new PostgresRuntimePersistence(pool, () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    const event = { id: "policy-event-1", agentId: "a", kind: "external" as const, occurredAt: fixtureInstant, payload: {}, correlationId: "shared-correlation" };
    await expect(first.authorizeInbound(event, "policy-message-1", 10)).resolves.toBeUndefined();
    await expect(second.authorizeInbound({ ...event, id: "policy-event-2" }, "policy-message-2", 10)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(second.authorizeInbound({ ...event, id: "policy-event-3", correlationId: "rate-correlation-1" }, "policy-message-3", 1)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("removes autonomous schedules when their persistent drives disappear", async () => {
    await pool.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ('drive:a:obsolete','a','persistent-drive','obsolete',now()),('drive:a:keep','a','persistent-drive','keep',now())");
    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const unit = new PostgresEventTransaction(new PostgresUnitOfWork(pool), 5_000);
    await unit.commit({ destination: "a", messageId: "drive-sync-message", event: { id: "drive-sync-event", agentId: "a", kind: "internal", observation: {}, source: "test", occurredAt: new Date(fixtureInstant) }, run: { id: "drive-sync-run", inputStateVersion: version, startedAt: new Date(fixtureInstant), result: {} }, stateValues: { drives: [{ description: "keep" }, { description: "new" }] }, changes: [], outbox: [] });
    expect((await pool.query<{ id: string }>("SELECT id FROM autonomous_schedules WHERE agent_id='a' AND kind='persistent-drive' ORDER BY id")).rows.map(({ id }) => id)).toEqual(["drive:a:keep", "drive:a:new"]);
    expect((await pool.query<{ delay_ms: number }>("SELECT round(extract(epoch FROM (next_due_at-updated_at))*1000)::int AS delay_ms FROM autonomous_schedules WHERE id='drive:a:new'")).rows[0]?.delay_ms).toBe(5_000);
  });

  it("updates long-term state, candidate and self-change memory atomically", async () => {
    await pool.query("INSERT INTO long_term_candidates(id,agent_id,target,proposed_value,status,reason) VALUES ('candidate-ok','a','selfNarrative','More patient','pending','Evidence'),('candidate-fail','a','selfNarrative','Should rollback','pending','Evidence')");
    await pool.query("INSERT INTO candidate_evidence(candidate_id,memory_id) VALUES ('candidate-ok','memory-a1'),('candidate-fail','memory-a1')");
    const selfChangeContent = "Changed selfNarrative from: Growing\nTo: I learn with patience";
    const selfChangeVector = Array.from({ length: 768 }, (_, index) => index === 2 ? 1 : 0);
    const selfChangeEmbedding = new PostgresMemoryEmbeddingLifecycle(pool, new FakeEmbeddingProvider({ [selfChangeContent]: selfChangeVector }), "review-fake");
    const repository = new PostgresLongTermReviewRepository(pool, () => "review-memory", selfChangeEmbedding);
    const service = new LongTermReviewService(repository, { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate-ok", decision: "UPDATE", reason: "Repeated experience" }], stateUpdate: { value: "I learn with patience", reason: "Repeated experience", evidenceMemoryIds: ["memory-a1"], evidenceEventIds: [] } }) });
    await service.review("candidate-ok", new AbortController().signal);
    expect((await pool.query<{ self_narrative: string }>("SELECT self_narrative FROM agent_states WHERE agent_id='a'")).rows[0]?.self_narrative).toBe("I learn with patience");
    expect((await pool.query("SELECT 1 FROM memories WHERE id='review-memory' AND kind='self-change'")).rowCount).toBe(1);
    expect((await pool.query<{ embedding_status: string; embedding_model: string }>("SELECT embedding_status,embedding_model FROM memories WHERE id='review-memory'")).rows[0]).toEqual({ embedding_status: "ready", embedding_model: "review-fake" });
    const failing = new LongTermReviewService(new PostgresLongTermReviewRepository(pool, () => "review-memory"), { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate-fail", decision: "UPDATE", reason: "Test rollback" }], stateUpdate: { value: "Should rollback", reason: "Test rollback", evidenceMemoryIds: ["memory-a1"], evidenceEventIds: [] } }) });
    await expect(failing.review("candidate-fail", new AbortController().signal)).rejects.toBeTruthy();
    expect((await pool.query<{ status: string }>("SELECT status FROM long_term_candidates WHERE id='candidate-fail'")).rows[0]?.status).toBe("pending");
    expect((await pool.query<{ self_narrative: string }>("SELECT self_narrative FROM agent_states WHERE agent_id='a'")).rows[0]?.self_narrative).toBe("I learn with patience");
  });

  it("loads Event-only evidence for long-term review and preserves it on the change record", async () => {
    const observation = { eventId: "review-event-evidence", summary: "The user's explicit feedback", facts: ["The proposal was adopted"], observedAt: fixtureInstant };
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('review-event-evidence','a','user-message',$1,'test','completed',$2)", [observation, fixtureInstant]);
    await pool.query("INSERT INTO long_term_candidates(id,agent_id,target,proposed_value,status,reason,evidence_event_ids) VALUES ('candidate-event-only','a','selfNarrative','I make useful proposals','pending','Explicit result',$1)", [JSON.stringify(["review-event-evidence"])]);
    const repository = new PostgresLongTermReviewRepository(pool, () => "event-review-memory");
    const service = new LongTermReviewService(repository, { review: (input) => {
      expect(input.evidenceEvents).toEqual([observation]);
      return Promise.resolve({ decisions: [{ candidateId: "candidate-event-only", decision: "UPDATE", reason: "Explicit result" }], stateUpdate: { value: "I make useful proposals", reason: "Explicit result", evidenceMemoryIds: [], evidenceEventIds: ["review-event-evidence"] } });
    } });
    await service.review("candidate-event-only", new AbortController().signal);
    expect((await pool.query<{ evidence_event_ids: string[] }>("SELECT evidence_event_ids FROM memories WHERE id='event-review-memory'")).rows[0]?.evidence_event_ids).toEqual(["review-event-evidence"]);
  });

  it("reviews list-valued state and grounded memory targets without immediate re-claim", async () => {
    await pool.query("INSERT INTO long_term_candidates(id,agent_id,target,proposed_value,status,reason,review_after) VALUES ('candidate-role','a','role','Research partner','pending','Repeated collaboration','2026-01-01'),('candidate-semantic','a','semanticMemory','The user prefers concise plans','pending','Explicit repeated preference','2026-01-01')");
    await pool.query("INSERT INTO candidate_evidence(candidate_id,memory_id) VALUES ('candidate-role','memory-a1'),('candidate-semantic','memory-a1')");
    const ids = ["role-change-memory", "semantic-grounded-memory"];
    const repository = new PostgresLongTermReviewRepository(pool, () => ids.shift() ?? "unexpected");
    await new LongTermReviewService(repository, { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate-role", decision: "UPDATE", reason: "Stable role" }], stateUpdate: { value: ["Helper", "Research partner"], reason: "Stable role", evidenceMemoryIds: ["memory-a1"], evidenceEventIds: [] } }) }).review("candidate-role", new AbortController().signal);
    expect((await pool.query<{ roles: string[] }>("SELECT roles FROM agent_states WHERE agent_id='a'")).rows[0]?.roles).toEqual(["Helper", "Research partner"]);
    await new LongTermReviewService(repository, { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate-semantic", decision: "UPDATE", reason: "Grounded fact" }], stateUpdate: { value: "The user prefers concise plans", reason: "Grounded fact", evidenceMemoryIds: ["memory-a1"], evidenceEventIds: [] } }) }).review("candidate-semantic", new AbortController().signal);
    expect((await pool.query<{ evidence_memory_ids: string[] }>("SELECT evidence_memory_ids FROM memories WHERE id='semantic-grounded-memory' AND kind='semantic'")).rows[0]?.evidence_memory_ids).toEqual(["memory-a1"]);

    await pool.query("INSERT INTO long_term_candidates(id,agent_id,target,proposed_value,status,reason,review_after) VALUES ('candidate-keep','a','longTermInterest','Distributed systems','pending','Needs more evidence','2026-01-01')");
    await pool.query("INSERT INTO candidate_evidence(candidate_id,memory_id) VALUES ('candidate-keep','memory-a1')");
    await new LongTermReviewService(repository, { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate-keep", decision: "KEEP", reason: "Wait for repetition" }] }) }).review("candidate-keep", new AbortController().signal);
    const kept = (await pool.query<{ status: string; review_after: Date }>("SELECT status,review_after FROM long_term_candidates WHERE id='candidate-keep'")).rows[0];
    expect(kept?.status).toBe("pending"); expect(kept?.review_after).toBeInstanceOf(Date);
  });

  it("updates Self Continuity only through grounded long-term review", async () => {
    await pool.query("INSERT INTO long_term_candidates(id,agent_id,target,proposed_value,status,reason) VALUES ('candidate-continuity','a','selfContinuity','My memory and unfinished commitments connect my experiences','pending','Repeated continuity concerns')");
    await pool.query("INSERT INTO candidate_evidence(candidate_id,memory_id) VALUES ('candidate-continuity','memory-a1')");
    const repository = new PostgresLongTermReviewRepository(pool, () => "continuity-change-memory");
    await new LongTermReviewService(repository, { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate-continuity", decision: "UPDATE", reason: "Repeated evidence" }], stateUpdate: { value: "My memory and unfinished commitments connect my experiences", reason: "Repeated evidence", evidenceMemoryIds: ["memory-a1"], evidenceEventIds: [] } }) }).review("candidate-continuity", new AbortController().signal);
    expect((await pool.query<{ self_continuity: string }>("SELECT self_continuity FROM agent_states WHERE agent_id='a'")).rows[0]?.self_continuity).toBe("My memory and unfinished commitments connect my experiences");
  });

  it("updates Values only through grounded long-term review", async () => {
    await pool.query("INSERT INTO long_term_candidates(id,agent_id,target,proposed_value,status,reason) VALUES ('candidate-values','a','values','Careful verification before confident claims','pending','Repeated corrections')");
    await pool.query("INSERT INTO candidate_evidence(candidate_id,memory_id) VALUES ('candidate-values','memory-a1')");
    const repository = new PostgresLongTermReviewRepository(pool, () => "values-change-memory");
    await new LongTermReviewService(repository, { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate-values", decision: "UPDATE", reason: "Repeated evidence" }], stateUpdate: { value: "Careful verification before confident claims", reason: "Repeated evidence", evidenceMemoryIds: ["memory-a1"], evidenceEventIds: [] } }) }).review("candidate-values", new AbortController().signal);
    expect((await pool.query<{ values: string }>("SELECT values FROM agent_states WHERE agent_id='a'")).rows[0]?.values).toBe("Careful verification before confident claims");
  });

  it("materializes normal Core proposals and Tool execution records with Runtime-owned metadata", async () => {
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,evidence_event_ids) VALUES ('proposal-evidence','a','self-related','Repeated follow-through','Relevant',now(),'[]')");
    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const input = agentCoreInputFixture();
    input.run = { runId: "runtime-run", eventId: "runtime-event", agentId: "a", occurredAt: fixtureInstant };
    input.self = { ...input.self, id: "a", version };
    input.dynamicState = { ...input.dynamicState, agentId: "a" };
    input.memories = [{ id: "proposal-evidence", agentId: "a", kind: "self-related", content: "Repeated follow-through", occurredAt: fixtureInstant, createdAt: fixtureInstant, relatedSubjectIds: [], importance: "Relevant", retrievalPriority: "normal", evidenceEventIds: [] }];
    input.availableTools = [{ name: "lookup", description: "Lookup", inputSchema: {} }];
    input.memoryRetrievalTrace = [{ memoryId: "proposal-evidence", finalRank: 1, matchedBy: ["subject", "recency"], kind: "self-related", selected: true }];
    const memoryVector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const memoryEmbedding = new PostgresMemoryEmbeddingLifecycle(pool, new FakeEmbeddingProvider({ "A useful exchange": memoryVector }), "runtime-fake");
    const persistence = new PostgresRuntimePersistence(pool, () => Promise.resolve(input), new SequenceIdGenerator(["tool-record", "continuity-job", "memory-job", "interest-new", "state-change-mood", "state-change-social", "state-change-drive", "state-change-interest", "memory-new", "candidate-job", "candidate-new"]), () => new Date(fixtureInstant), memoryEmbedding);
    const message = messageFixture({ id: "runtime-message", destination: "agent:a" });
    const event = { id: "runtime-event", agentId: "a", kind: "user-message" as const, occurredAt: fixtureInstant, payload: { text: "hello" }, causationId: "incoming-message", correlationId: "conversation-1" };
    const result = {
      output: { interpretation: {}, internalChanges: { immediateStateUpdates: [] }, action: { type: "respond" as const, content: "Hello" } },
      toolExecutions: [{ callId: "tool-1", runId: "runtime-run", eventId: "runtime-event", name: "lookup", input: { q: "x" }, ok: true, result: { answer: 1 }, startedAt: fixtureInstant, finishedAt: fixtureInstant }]
    };
    await expect(persistence.commit(message, event, input, result, { state: input.dynamicState, changes: [] }, [])).resolves.toBe("committed");
    const jobPayloads = (await pool.query<{ payload: Record<string, unknown> }>("SELECT payload FROM post_process_jobs WHERE interaction_run_id='runtime-run'")).rows.map(({ payload }) => payload);
    expect(jobPayloads).toHaveLength(2);
    for (const payload of jobPayloads) {
      expect(payload).not.toHaveProperty("availableTools");
      expect(payload).not.toHaveProperty("runtimeConstraints");
      expect(payload).not.toHaveProperty("limits");
      expect(payload).not.toHaveProperty("memoryRetrievalTrace");
    }
    const job = await persistence.claimPostProcess("a", "runtime-run"); if (job === undefined) throw new Error("Post-process job was not created");
    if (job.type !== "continuity") throw new Error("Continuity job was not created");
    await persistence.completePostProcess(job, { persistentStateUpdates: [{ target: "mood", operation: "set", value: "Attentive", reason: "Conversation", evidenceIds: [] }, { target: "socialContext", operation: "set", value: { subjectId: "owner", subjectType: "user", description: "Trusted collaborator" }, reason: "Conversation", evidenceIds: [] }], driveProposals: [{ operation: "create", description: "Understand the exchange", reason: "The event remains meaningful", evidenceIds: ["runtime-event"] }], currentInterestProposals: [{ operation: "create", focus: "What made the exchange useful?", goal: "Explain the useful part", progress: 25, reason: "The interaction created a concrete question", evidenceIds: ["runtime-event"] }] });
    const memoryJob = await persistence.claimPostProcess("a", "runtime-run"); if (memoryJob?.type !== "memory") throw new Error("Memory job was not created");
    await persistence.completePostProcess(memoryJob, { memoryProposals: [{ content: "A useful exchange", relatedSubjectIds: ["owner"], importance: "Useful", retrievalPriority: "high", webSnapshotIds: [] }, { content: "A useful exchange", relatedSubjectIds: ["owner"], importance: "Useful", retrievalPriority: "high", webSnapshotIds: [] }] });
    const candidateJob = await persistence.claimPostProcess("a", "runtime-run"); if (candidateJob?.type !== "candidate") throw new Error("Candidate job was not created");
    await persistence.completePostProcess(candidateJob, { longTermCandidates: [{ target: "selfNarrative", proposal: "I follow through", reason: "Repeated evidence", evidenceMemoryIds: ["memory-new"], evidenceEventIds: [] }] });
    expect((await pool.query<{ agent_id: string }>("SELECT agent_id FROM memories WHERE id='memory-new'")).rows[0]?.agent_id).toBe("a");
    expect((await pool.query<{ embedding_status: string; embedding_model: string }>("SELECT embedding_status,embedding_model FROM memories WHERE id='memory-new'")).rows[0]).toEqual({ embedding_status: "ready", embedding_model: "runtime-fake" });
    expect((await pool.query<{ agent_id: string; status: string }>("SELECT agent_id,status FROM long_term_candidates WHERE id='candidate-new'")).rows[0]).toMatchObject({ agent_id: "a", status: "pending" });
    expect((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM memories WHERE evidence_event_ids ? 'runtime-event' AND content='A useful exchange'")).rows[0]?.count).toBe("1");
    expect((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM long_term_candidates WHERE proposed_value='I follow through'")).rows[0]?.count).toBe("1");
    expect((await pool.query<{ event_id: string; tool: string }>("SELECT event_id,tool FROM tool_executions WHERE id='tool-record'")).rows[0]).toEqual({ event_id: "runtime-event", tool: "lookup" });
    expect((await pool.query<{ causation_id: string; correlation_id: string }>("SELECT causation_id,correlation_id FROM events WHERE id='runtime-event'")).rows[0]).toEqual({ causation_id: "incoming-message", correlation_id: "conversation-1" });
    expect((await pool.query<{ kind: string; causation_id: string; correlation_id: string }>("SELECT kind,causation_id,correlation_id FROM events WHERE id='runtime-event:tool-result:tool-1'")).rows[0]).toEqual({ kind: "tool-result", causation_id: "runtime-event", correlation_id: "conversation-1" });
    expect((await pool.query<{ result_event_id: string }>("SELECT result_event_id FROM tool_executions WHERE id='tool-record'")).rows[0]?.result_event_id).toBe("runtime-event:tool-result:tool-1");
    expect((await pool.query<{ description: string }>("SELECT description FROM social_contexts WHERE agent_id='a' AND subject_id='owner'")).rows[0]?.description).toBe("Trusted collaborator");
    expect((await pool.query<{ drives: { description: string; since: string }[] }>("SELECT drives FROM agent_states WHERE agent_id='a'")).rows[0]?.drives).toContainEqual(expect.objectContaining({ description: "Understand the exchange", since: fixtureInstant }));
    expect((await pool.query<{ current_interests: { id: string; progress: number }[]; interest_exploration: { interestId: string; consecutiveNoProgress: number }[] }>("SELECT current_interests,interest_exploration FROM agent_states WHERE agent_id='a'")).rows[0]).toMatchObject({ current_interests: [{ id: "interest-new", progress: 25 }], interest_exploration: [{ interestId: "interest-new", consecutiveNoProgress: 0 }] });
    expect((await pool.query<{ result: { memoryRetrievalTrace?: unknown[] } }>("SELECT result FROM agent_runs WHERE id='runtime-run'")).rows[0]?.result.memoryRetrievalTrace).toEqual(input.memoryRetrievalTrace);
  });

  it("creates only a Continuity job for state-review", async () => {
    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const input = agentCoreInputFixture();
    input.run = { runId: "state-review-run", eventId: "state-review-event", agentId: "a", occurredAt: fixtureInstant };
    input.observation = { ...input.observation, eventId: "state-review-event", summary: "Review persistent state", content: { targetKind: "state-review", schedulerGenerated: true } };
    input.self = { ...input.self, id: "a", version };
    input.dynamicState = { ...input.dynamicState, agentId: "a" };
    const persistence = new PostgresRuntimePersistence(pool, () => Promise.resolve(input), new SequenceIdGenerator(["state-review-continuity-job"]), () => new Date(fixtureInstant));
    const message = messageFixture({ id: "state-review-message", destination: "a" });
    const event = { id: "state-review-event", agentId: "a", kind: "internal" as const, occurredAt: fixtureInstant, payload: { targetKind: "state-review", schedulerGenerated: true } };
    const result = { output: { interpretation: { subjectiveMeaning: "Persistent state review" }, internalChanges: { immediateStateUpdates: [] }, action: { type: "no-external-action" as const, reason: "Continuity only" } }, toolExecutions: [] };
    await expect(persistence.commit(message, event, input, result, { state: input.dynamicState, changes: [] }, [])).resolves.toBe("committed");
    const jobs = await pool.query<{ job_type: string }>("SELECT job_type FROM post_process_jobs WHERE interaction_run_id='state-review-run' ORDER BY job_type");
    expect(jobs.rows).toEqual([{ job_type: "continuity" }]);
    expect((await pool.query<{ result: { output: { action: { type: string } } } }>("SELECT result FROM agent_runs WHERE id='state-review-run'")).rows[0]?.result.output.action.type).toBe("no-external-action");
  });

  it("derives reported Memory provenance from the validated Observation actor", async () => {
    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const input = agentCoreInputFixture(); input.run = { runId: "reported-run", eventId: "reported-event", agentId: "a", occurredAt: fixtureInstant }; input.self = { ...input.self, id: "a", version }; input.dynamicState = { ...input.dynamicState, agentId: "a" }; input.observation = { eventId: "reported-event", summary: "Agent B reported a library time", facts: ["Reported by B"], observedAt: fixtureInstant, actor: { id: "b", type: "agent" }, source: { type: "agent", id: "b", direct: true } };
    const persistence = new PostgresRuntimePersistence(pool, () => Promise.resolve(input), new SequenceIdGenerator(["reported-continuity-job", "reported-memory-job", "reported-memory"]), () => new Date("2026-01-03T00:00:00Z"));
    const result = { output: { interpretation: {}, internalChanges: { immediateStateUpdates: [] }, action: { type: "no-external-action" as const, reason: "Recorded" } }, toolExecutions: [] };
    await persistence.commit(messageFixture({ id: "reported-message", destination: "a" }), { id: "reported-event", agentId: "a", kind: "external", occurredAt: fixtureInstant, payload: { senderAgentId: "b" } }, input, result, { state: input.dynamicState, changes: [] }, []);
    const reportedJob = await persistence.claimPostProcess("a", "reported-run"); if (reportedJob === undefined) throw new Error("Post-process job was not created");
    if (reportedJob.type === "continuity") await persistence.completePostProcess(reportedJob, { persistentStateUpdates: [], driveProposals: [], currentInterestProposals: [] });
    const reportedMemoryJob = reportedJob.type === "memory" ? reportedJob : await persistence.claimPostProcess("a", "reported-run"); if (reportedMemoryJob?.type !== "memory") throw new Error("Memory job was not created");
    await persistence.completePostProcess(reportedMemoryJob, { memoryProposals: [{ content: "Agent B reported that the library opens at nine", relatedSubjectIds: ["b"], importance: "Reported information", retrievalPriority: "normal", webSnapshotIds: [] }] });
    expect((await pool.query<{ source_agent_id: string }>("SELECT source_agent_id FROM memories WHERE id='reported-memory'")).rows[0]?.source_agent_id).toBe("b");
    expect((await pool.query<{ occurred_at: Date; created_at: Date }>("SELECT occurred_at,created_at FROM memories WHERE id='reported-memory'")).rows[0]).toMatchObject({ occurred_at: new Date(fixtureInstant), created_at: new Date("2026-01-03T00:00:00Z") });
  });

  it("records Tool side effects when final Agent output fails without marking the message complete", async () => {
    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const input = agentCoreInputFixture();
    input.run = { runId: "failed-run", eventId: "failed-event", agentId: "a", occurredAt: fixtureInstant };
    input.self = { ...input.self, id: "a", version }; input.dynamicState = { ...input.dynamicState, agentId: "a" };
    input.availableTools = [{ name: "lookup", description: "Lookup", inputSchema: {} }];
    const persistence = new PostgresRuntimePersistence(pool, () => Promise.resolve(input), new SequenceIdGenerator(["failed-tool-record"]), () => new Date(fixtureInstant));
    const message = messageFixture({ id: "failed-message", destination: "agent:a" });
    const event = { id: "failed-event", agentId: "a", kind: "user-message" as const, occurredAt: fixtureInstant, payload: { text: "hello" } };
    await persistence.recordFailure(message, event, input, new Error("invalid final output"), [{ callId: "tool-1", runId: "failed-run", eventId: "failed-event", name: "lookup", input: { q: "x" }, ok: true, result: { answer: 1 }, startedAt: fixtureInstant, finishedAt: fixtureInstant }]);
    expect((await pool.query<{ failure_reason: string }>("SELECT failure_reason FROM agent_runs WHERE id='failed-run'")).rows[0]?.failure_reason).toContain("invalid final output");
    expect((await pool.query("SELECT 1 FROM tool_executions WHERE id='failed-tool-record'")).rowCount).toBe(1);
    expect((await pool.query("SELECT 1 FROM message_receipts WHERE message_id='failed-message'")).rowCount).toBe(0);
  });
});
