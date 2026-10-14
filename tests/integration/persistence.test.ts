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
import { PostgresRuntimePersistence } from "../../src/infrastructure/persistence/postgres-runtime-persistence.js";
import { PostgresReflectionRepository } from "../../src/infrastructure/persistence/postgres-reflection.js";
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
import { createScheduledTaskTools } from "../../src/infrastructure/tools/scheduled-task-tools.js";
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
    for (const agentId of ["a", "b"]) await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,concerns,relationships,mood) VALUES ($1,'Careful learner','Growing continuously','[\"Care\"]','[]','[]','Calm')", [agentId]);
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
    expect((await repository.find<{ commitments: string[]; concerns: unknown[] }>("a"))).toMatchObject({ commitments: ["Care"], concerns: [] });
  });

  it("initializes configured Self and preserves acquired experience on reapply", async () => {
    const config = {
      version: 1 as const,
      family: { id: "configured-family", name: "Configured", sharedDisposition: "共通傾向", baseInstruction: "根拠を区別する" },
      agent: { id: "configured-agent", identity: "Configured Agent", initialDisposition: "具体的な対象を調べることが好きで、根拠のない断定は嫌い", raisonDetre: "対話相手との約束を守る", selfNarrative: "始まったばかり", selfContinuity: "経験をつなぐ" },
      initialState: { mood: "中立", concerns: [], relationships: [] }
    };
    const initialTimings = { autonomyReviewIntervalMs: 2_000, stateReviewIntervalMs: 3_000, memoryRecallIntervalMs: 4_000 };
    await initializeAgent(pool, config, initialTimings);
    expect((await pool.query<{ kind: string }>("SELECT kind FROM autonomous_schedules WHERE agent_id=$1 AND kind='idle'", [config.agent.id])).rows).toEqual([{ kind: "idle" }]);
    expect((await pool.query<{ kind: string; delay_ms: number }>("SELECT kind,round(extract(epoch FROM (next_due_at-updated_at))*1000)::int AS delay_ms FROM autonomous_schedules WHERE agent_id=$1 ORDER BY kind", [config.agent.id])).rows).toEqual([{ kind: "idle", delay_ms: 2_000 }, { kind: "reflection", delay_ms: 3_000 }]);
    await pool.query("UPDATE agent_states SET disposition='経験で得た傾向',mood='持続する気分',concerns=$2,relationships=$3 WHERE agent_id=$1", [config.agent.id, JSON.stringify([{ id: "concern-existing", description: "継続中の関心", whyItMatters: "大切", status: "active" }]), JSON.stringify([{ subjectId: "owner", description: "継続する関係" }])]);
    await initializeAgent(pool, { ...config, agent: { ...config.agent, initialDisposition: "再適用された初期傾向" } }, initialTimings);
    const loaded = await pool.query<{ shared_disposition: string; initial_disposition: string; disposition: string; mood: string; concerns: unknown; relationships: unknown }>("SELECT f.shared_disposition,a.initial_disposition,s.disposition,s.mood,s.concerns,s.relationships FROM agents a JOIN agent_families f ON f.id=a.family_id JOIN agent_states s ON s.agent_id=a.id WHERE a.id=$1", [config.agent.id]);
    expect(loaded.rows[0]).toMatchObject({ shared_disposition: "共通傾向", initial_disposition: config.agent.initialDisposition, disposition: "経験で得た傾向", mood: "持続する気分", concerns: [{ description: "継続中の関心" }], relationships: [{ subjectId: "owner" }] });
    const redesigned = await pool.query<{ disposition: string; self_story: string; commitments: string[]; concerns: unknown[]; relationships: unknown[] }>("SELECT disposition,self_story,commitments,concerns,relationships FROM agent_states WHERE agent_id=$1", [config.agent.id]);
    expect(redesigned.rows[0]?.disposition).toBe("経験で得た傾向"); expect(redesigned.rows[0]?.self_story).toContain("始まったばかり"); expect(redesigned.rows[0]?.commitments).toContain("対話相手との約束を守る"); expect(redesigned.rows[0]?.concerns).toMatchObject([{ id: "concern-existing" }]); expect(redesigned.rows[0]?.relationships).toMatchObject([{ subjectId: "owner" }]);
    await initializeAgent(pool, { ...config, family: { ...config.family, sharedDisposition: "更新した共通傾向" }, agent: { ...config.agent, initialDisposition: "映像史とAI技術が好きで、誇張は嫌い" } }, initialTimings, { overwriteConfiguredSelf: true });
    const overwritten = await pool.query<{ shared_disposition: string; disposition: string; commitments: string[]; mood: string; concerns: unknown; relationships: unknown; version: number }>("SELECT f.shared_disposition,s.disposition,s.commitments,s.mood,s.concerns,s.relationships,s.version FROM agents a JOIN agent_families f ON f.id=a.family_id JOIN agent_states s ON s.agent_id=a.id WHERE a.id=$1", [config.agent.id]);
    expect(overwritten.rows[0]).toMatchObject({ shared_disposition: "更新した共通傾向", mood: "持続する気分", concerns: [{ description: "継続中の関心" }], relationships: [{ subjectId: "owner" }], version: 1 });
    expect(overwritten.rows[0]?.disposition).toContain("更新した共通傾向");
    expect(overwritten.rows[0]?.disposition).toContain("映像史とAI技術が好き");
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

  it("loads a complete Agent Core context from PostgreSQL without crossing Agent ownership", async () => {
    await pool.query("UPDATE agent_families SET base_instruction='' WHERE id='family'");
    await pool.query("UPDATE agent_states SET relationships=$2 WHERE agent_id=$1", ["a", JSON.stringify([{ subjectId: "owner", description: "Trusted" }])]);
    await pool.query("INSERT INTO memory_subjects(memory_id,subject_id) VALUES ('memory-a1','owner') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('recent-a','a','user-message',$1,'test','completed','2026-01-01'),('recent-b','b','user-message',$2,'test','completed','2026-01-01')", [JSON.stringify({ eventId: "recent-a", summary: "previous exchange", facts: ["prior context"], observedAt: fixtureInstant }), JSON.stringify({ eventId: "recent-b", summary: "private exchange", facts: ["other agent"], observedAt: fixtureInstant })]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('large-tool-result','a','tool-result',$1,'web_page','completed',now())", [JSON.stringify({ eventId: "large-tool-result", summary: "web_page result", facts: ["tool result"], observedAt: fixtureInstant, content: { markdown: "x".repeat(100_000) } })]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('attempt-event-a','a','internal',$1,'scheduler','completed',now()),('attempt-event-b','b','internal',$2,'scheduler','completed',now())", [JSON.stringify({ eventId: "attempt-event-a", summary: "recent attempt", facts: [], observedAt: new Date().toISOString() }), JSON.stringify({ eventId: "attempt-event-b", summary: "foreign attempt", facts: [], observedAt: new Date().toISOString() })]);
    await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,result,started_at,finished_at) VALUES ('attempt-run-a','a','attempt-event-a',0,$1,now(),now()),('attempt-run-b','b','attempt-event-b',0,$2,now(),now())", [JSON.stringify({ output: { action: { type: "respond", content: "最近、何に関心がありますか？" } } }), JSON.stringify({ output: { action: { type: "respond", content: "private" } } })]);
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('failed-experience-a','a','internal',$1,'scheduler','failed',now())", [JSON.stringify({ eventId: "failed-experience-a", summary: "failed exploration", facts: [], observedAt: new Date().toISOString(), kind: "internal" })]);
    await pool.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,result,failure_reason,started_at,finished_at) VALUES ('failed-run-a','a','failed-experience-a',0,NULL,'provider timeout',now(),now())");
    await pool.query("INSERT INTO tool_executions(id,run_id,event_id,tool_call_id,tool,input,result,error,started_at,finished_at) VALUES ('failed-tool-a','failed-run-a','failed-experience-a','call-1','web_list',$1,$2,NULL,now(),now())", [JSON.stringify({ q: "agent memory" }), JSON.stringify({ results: [] })]);
    await pool.query("INSERT INTO tool_executions(id,run_id,event_id,tool_call_id,tool,input,result,error,started_at,finished_at) VALUES ('failed-file-tool-a','failed-run-a','failed-experience-a','call-2','file_read',$1,$2,NULL,now(),now())", [JSON.stringify({ path: "notes.md", content: "raw input must not enter recent experiences".repeat(100) }), JSON.stringify({ path: "notes.md", content: "raw file must not enter recent experiences", truncated: false })]);
    const vector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const loader = new PostgresAgentContextLoader({
      pool, ids: new SequenceIdGenerator(["context-run", "context-run-2", "context-run-b"]), embedding: new FakeEmbeddingProvider({ hello: vector }), tools: new ToolRegistry([...createWebTools("http://web.local"), { name: "file_read", description: "Read", schema: z.object({}), resultPolicy: { kind: "content-read" as const, defaultRequestCharacters: 2_000, runCharacterBudget: 6_000 }, execute: () => Promise.resolve({ ok: true }) }]),
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
    expect(input.memories.every(({ agentId }) => agentId === "a")).toBe(true);
    expect(input.memories.find(({ id }) => id === "memory-a1")).toMatchObject({ relatedSubjectIds: ["owner"] });
    expect(input.recentExperiences.map(({ eventId }) => eventId)).toEqual(expect.arrayContaining(["attempt-event-a", "failed-experience-a"]));
    expect(input.recentExperiences.map(({ eventId }) => eventId)).toContain("recent-a");
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
    expect(input.recentExperiences.find(({ eventId }) => eventId === "recent-a")?.observation).toEqual({ summary: "previous exchange", facts: ["prior context"] });
    expect(input.runtimeConstraints.every((value) => value.length > 0)).toBe(true);
    expect(input.runtimeConstraints.join(" ")).not.toContain("Curious");
    expect(input.availableTools.map(({ name }) => name)).toEqual(["web_list", "web_page", "file_read"]);
    const allowed = await loader.load({ id: "context-event-2", agentId: "a", kind: "user-message", occurredAt: fixtureInstant, payload: { text: "hello" } });
    expect(allowed.availableTools.map(({ name }) => name)).toEqual(input.availableTools.map(({ name }) => name));
    const other = await loader.load({ id: "context-event-b", agentId: "b", kind: "user-message", occurredAt: fixtureInstant, payload: { text: "hello" } });
    expect(other.currentSelf.disposition).toBe("Careful learner");
    const saved = await pool.query<{ concerns: unknown }>("SELECT concerns FROM agent_states WHERE agent_id='a'");
    await pool.query("UPDATE agent_states SET concerns='[{}]' WHERE agent_id='a'");
    try {
      await expect(loader.load({ id: "invalid-state-event", agentId: "a", kind: "internal", occurredAt: fixtureInstant, payload: {} })).rejects.toThrow("concerns");
    } finally { await pool.query("UPDATE agent_states SET concerns=$1 WHERE agent_id='a'", [JSON.stringify(saved.rows[0]?.concerns)]); }

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

  it("updates only an owned pending Scheduled Task", async () => {
    await pool.query("INSERT INTO scheduled_tasks(id,agent_id,execute_at,instruction,status,idempotency_key,source_event_id,source_run_id) VALUES ('task-update-a','a','2026-01-02','元の指示','scheduled','update-key-a','source-event','source-run'),('task-update-b','b','2026-01-02','他Agentの指示','scheduled','update-key-b','source-event','source-run')");
    const registry = new ToolRegistry(createScheduledTaskTools(pool, new SequenceIdGenerator([]), () => new Date("2026-01-01T00:00:00Z")));
    const signal = new AbortController().signal;
    await expect(registry.execute("scheduled_task_update", { taskId: "task-update-a", executeAt: "2026-01-03T00:00:00Z", instruction: "更新後の指示" }, { agentId: "a", runId: "update-run", eventId: "update-event", idempotencyKey: "update-call" }, signal)).resolves.toMatchObject({ ok: true, value: { id: "task-update-a", instruction: "更新後の指示", status: "scheduled" } });
    await expect(registry.execute("scheduled_task_update", { taskId: "task-update-b", instruction: "越境更新" }, { agentId: "a", runId: "update-run", eventId: "update-event", idempotencyKey: "cross-owner" }, signal)).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect((await pool.query<{ instruction: string }>("SELECT instruction FROM scheduled_tasks WHERE id='task-update-b'")).rows[0]?.instruction).toBe("他Agentの指示");
  });

  it("never claims a legacy or unknown autonomous schedule kind", async () => {
    await pool.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ('legacy-drive','a','autonomy-review','legacy','2026-01-01'),('idle-due','a','idle','idle','2026-01-01')");
    const repository = new PostgresScheduleRepository(pool);
    const claims = await repository.claimDue(new Date("2026-01-02T00:00:00Z"), 10);
    expect(claims.map(({ id }) => id)).toContain("idle-due");
    expect(claims.map(({ id }) => id)).not.toContain("legacy-drive");
    expect((await pool.query<{ lease_until: Date | null }>("SELECT lease_until FROM autonomous_schedules WHERE id='legacy-drive'")).rows[0]?.lease_until).toBeNull();
  });

  it("rotates the persisted idle exploration mode only after successful completion", async () => {
    await pool.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,exploration_mode,next_due_at) VALUES ('idle-mode:b','b','idle','explore','distant','2026-01-01')");
    const repository = new PostgresScheduleRepository(pool, 60_000, "b");
    const first = (await repository.claimDue(new Date("2026-01-02T00:00:00Z"), 10)).find(({ id }) => id === "idle-mode:b");
    expect(first).toMatchObject({ kind: "idle", explorationMode: "distant", explorationCursor: 0 });
    if (first === undefined) throw new Error("Idle schedule was not claimed");
    await repository.release(first);
    expect((await pool.query<{ exploration_mode: string; exploration_cursor: number }>("SELECT exploration_mode,exploration_cursor FROM autonomous_schedules WHERE id='idle-mode:b'")).rows[0]).toMatchObject({ exploration_mode: "distant", exploration_cursor: 0 });
    await pool.query("UPDATE autonomous_schedules SET next_due_at='2026-01-01' WHERE id='idle-mode:b'");
    const second = (await repository.claimDue(new Date("2026-01-02T00:00:00Z"), 10)).find(({ id }) => id === "idle-mode:b");
    expect(second).toMatchObject({ kind: "idle", explorationMode: "distant", explorationCursor: 0 });
    if (second === undefined) throw new Error("Retried idle schedule was not claimed");
    await repository.complete(second, new Date("2026-01-03T00:00:00Z"));
    expect((await pool.query<{ exploration_mode: string; exploration_cursor: number }>("SELECT exploration_mode,exploration_cursor FROM autonomous_schedules WHERE id='idle-mode:b'")).rows[0]).toMatchObject({ exploration_mode: "deepen", exploration_cursor: 8 });
  });

  it("backs off repeated Reflection failures instead of retrying at a fixed interval", async () => {
    await pool.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ('reflection:a','a','reflection','maintenance',now())");
    for (const id of ["reflection-failed-1", "reflection-failed-2", "reflection-failed-3"]) {
      await pool.query("INSERT INTO reflection_runs(id,agent_id,input_state_version,status,input,failure_reason) VALUES ($1,'a',0,'failed','{}','invalid output')", [id]);
    }
    const repository = new PostgresScheduleRepository(pool, 60_000, "a", 1_000);
    await repository.release({ id: "reflection:a", agentId: "a", kind: "reflection", reason: "maintenance" });
    const row = (await pool.query<{ delay_ms: number }>("SELECT round(extract(epoch FROM (next_due_at-updated_at))*1000)::int AS delay_ms FROM autonomous_schedules WHERE id='reflection:a'")).rows[0];
    expect(row?.delay_ms).toBe(4_000);
  });

  it("shares correlation-loop and rate limits across Runtime instances", async () => {
    const first = new PostgresRuntimePersistence(pool, () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    const second = new PostgresRuntimePersistence(pool, () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    const event = { id: "policy-event-1", agentId: "a", kind: "external" as const, occurredAt: fixtureInstant, payload: {}, correlationId: "shared-correlation" };
    await expect(first.authorizeInbound(event, "policy-message-1", 10)).resolves.toBeUndefined();
    await expect(second.authorizeInbound({ ...event, id: "policy-event-2" }, "policy-message-2", 10)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(second.authorizeInbound({ ...event, id: "policy-event-3", correlationId: "rate-correlation-1" }, "policy-message-3", 1)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("materializes normal Core proposals and Tool execution records with Runtime-owned metadata", async () => {
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,evidence_event_ids) VALUES ('proposal-evidence','a','self-related','Repeated follow-through','Relevant',now(),'[]')");
    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const input = agentCoreInputFixture();
    input.run = { runId: "runtime-run", eventId: "runtime-event", agentId: "a", occurredAt: fixtureInstant };
    input.currentSelf = { ...input.currentSelf, agentId: "a", version };
    input.state = { ...input.state, agentId: "a" };
    input.memories = [{ id: "proposal-evidence", agentId: "a", kind: "self-related", content: "Repeated follow-through", occurredAt: fixtureInstant, createdAt: fixtureInstant, relatedSubjectIds: [], importance: "Relevant", retrievalPriority: "normal", evidenceEventIds: [] }];
    input.availableTools = [{ name: "lookup", description: "Lookup", inputSchema: {} }];
    input.memoryRetrievalTrace = [{ memoryId: "proposal-evidence", finalRank: 1, matchedBy: ["subject", "recency"], kind: "self-related", selected: true }];
    const memoryVector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const memoryEmbedding = new PostgresMemoryEmbeddingLifecycle(pool, new FakeEmbeddingProvider({ "A useful exchange": memoryVector }), "runtime-fake");
    const persistence = new PostgresRuntimePersistence(pool, () => Promise.resolve(input), new SequenceIdGenerator(["tool-record", "integration-job", "motive-new", "memory-new", "state-change-mood", "state-change-social", "state-change-motive"]), () => new Date(fixtureInstant), memoryEmbedding);
    const message = messageFixture({ id: "runtime-message", destination: "agent:a" });
    const event = { id: "runtime-event", agentId: "a", kind: "user-message" as const, occurredAt: fixtureInstant, payload: { text: "hello" }, causationId: "incoming-message", correlationId: "conversation-1" };
    const result = {
      output: { desire: "respond to this event", action: { type: "respond" as const, content: "Hello" } },
      toolExecutions: [{ callId: "tool-1", runId: "runtime-run", eventId: "runtime-event", name: "lookup", input: { q: "x" }, ok: true, result: { answer: 1 }, startedAt: fixtureInstant, finishedAt: fixtureInstant }]
    };
    await expect(persistence.commit(message, event, input, result, { state: input.state, changes: [] }, [])).resolves.toBe("committed");
    expect((await pool.query<{ event_id: string; tool: string }>("SELECT event_id,tool FROM tool_executions WHERE id='tool-record'")).rows[0]).toEqual({ event_id: "runtime-event", tool: "lookup" });
    expect((await pool.query<{ causation_id: string; correlation_id: string }>("SELECT causation_id,correlation_id FROM events WHERE id='runtime-event'")).rows[0]).toEqual({ causation_id: "incoming-message", correlation_id: "conversation-1" });
    expect((await pool.query<{ kind: string; causation_id: string; correlation_id: string }>("SELECT kind,causation_id,correlation_id FROM events WHERE id='runtime-event:tool-result:tool-1'")).rows[0]).toEqual({ kind: "tool-result", causation_id: "runtime-event", correlation_id: "conversation-1" });
    expect((await pool.query<{ result_event_id: string }>("SELECT result_event_id FROM tool_executions WHERE id='tool-record'")).rows[0]?.result_event_id).toBe("runtime-event:tool-result:tool-1");
    expect((await pool.query<{ result: { memoryRetrievalTrace?: unknown[] } }>("SELECT result FROM agent_runs WHERE id='runtime-run'")).rows[0]?.result.memoryRetrievalTrace).toEqual(input.memoryRetrievalTrace);
  });

  it("commits Reflection state and Memory atomically and deduplicates retries", async () => {
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('reflection-event','a','user-message',$1,'test','completed',$2)", [{ summary: "約束を果たした" }, fixtureInstant]);
    const repository = new PostgresReflectionRepository(pool, new SequenceIdGenerator(["reflection-memory"]), () => new Date("2026-01-02T00:00:00Z"));
    const input = await repository.load("reflection-1", "a"); if (input === undefined) throw new Error("Reflection input was not created");
    const output = { memories: [{ summary: "約束を果たした", significance: "信頼が深まった", subjects: ["owner"], occurredAt: fixtureInstant }], concernChanges: [{ operation: "upsert" as const, concern: { id: "concern-1", description: "信頼を守る", whyItMatters: "約束を重視している", status: "active" as const } }], relationshipChanges: [{ operation: "upsert" as const, relationship: { subjectId: "owner", description: "約束を守り合える相手" } }], mood: "穏やかな達成感", evidenceMemoryIds: [] };
    await expect(repository.commit(input, output)).resolves.toBe("committed");
    await expect(repository.commit(input, output)).resolves.toBe("duplicate");
    expect((await pool.query<{ concerns: { id: string }[]; relationships: { subjectId: string }[] }>("SELECT concerns,relationships FROM agent_states WHERE agent_id='a'")).rows[0]).toMatchObject({ concerns: [{ id: "concern-1" }], relationships: [{ subjectId: "owner" }] });
    expect((await pool.query<{ content: string; importance: string }>("SELECT content,importance FROM memories WHERE id='reflection-memory'")).rows[0]).toEqual({ content: "約束を果たした", importance: "信頼が深まった" });
    expect((await pool.query<{ status: string }>("SELECT status FROM reflection_runs WHERE id='reflection-1'")).rows[0]?.status).toBe("completed");
  });

  it("records Tool side effects when final Agent output fails without marking the message complete", async () => {
    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const input = agentCoreInputFixture();
    input.run = { runId: "failed-run", eventId: "failed-event", agentId: "a", occurredAt: fixtureInstant };
    input.currentSelf = { ...input.currentSelf, agentId: "a", version }; input.state = { ...input.state, agentId: "a" };
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
