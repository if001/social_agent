import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";

import { parse } from "dotenv";
import { Pool } from "pg";

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
    await pool.query("INSERT INTO agent_families(id,name,shared_disposition,capabilities,base_instruction) VALUES ('family','Family','Curious','[]','Help')");
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ('a','family','Agent A','Calm'),('b','family','Agent B','Bold')");
    for (const agentId of ["a", "b"]) await pool.query("INSERT INTO agent_states(agent_id,acquired_disposition,values,role,self_narrative,self_continuity,emotion,mood,drive,desire) VALUES ($1,'Learning','Care','Helper','Growing','Continuous','Interested','Calm','Learn','Help')", [agentId]);
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
    expect((await repository.find<{ roles: string[]; drives: string[]; desires: string[] }>("a"))).toMatchObject({ roles: ["Helper"], drives: ["Learn"], desires: ["Help"] });
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
    const found = await retriever.retrieve("a", { text: "typescript", keywords: ["typescript"], subjectIds: [], intentionIds: [], kinds: ["semantic"] }, unit, 5);
    expect(found.memories.map(({ id }) => id)).toEqual(["memory-a1"]);
    expect(found.memories.every(({ agentId }) => agentId === "a")).toBe(true);
  });

  it("ranks Japanese keyword, subject, intention, priority and category candidates with a stable fallback", async () => {
    await pool.query("INSERT INTO intentions(id,agent_id,description,reason,status) VALUES ('rank-intention','a','研究発表を支援する','約束','active')");
    await pool.query(`INSERT INTO memories(id,agent_id,kind,content,importance,retrieval_priority,occurred_at,embedding_status) VALUES
      ('rank-episodic','a','episodic','来週の研究発表について相談した','予定','normal','2026-02-01','failed'),
      ('rank-semantic','a','semantic','発表では結論を先に伝えることを好む','明示された好み','normal','2026-01-20','pending'),
      ('rank-self','a','self-related','私は発表準備を整理して支援してきた','自己理解','normal','2026-01-10','pending'),
      ('rank-self-change','a','self-change','発表支援で自己認識が変化した','監査','critical','2026-02-02','pending'),
      ('rank-other-agent','b','semantic','研究発表の秘密','非公開','critical','2026-02-03','pending'),
      ('priority-high','a','episodic','古いが重要な記憶','重要','high','2025-01-01','pending'),
      ('priority-normal','a','episodic','新しい通常の記憶','通常','normal','2026-03-01','pending')`);
    await pool.query("INSERT INTO memory_subjects(memory_id,subject_id) VALUES ('rank-semantic','owner')");
    await pool.query("INSERT INTO memory_intentions(memory_id,intention_id) VALUES ('rank-self','rank-intention')");
    const retriever = new PostgresMemoryRetriever(pool);
    const query = { text: "研究発表", keywords: ["研究", "発表"], subjectIds: ["owner"], intentionIds: ["rank-intention"], kinds: ["episodic", "semantic", "self-related"] as const };
    const first = await retriever.retrieve("a", query, [], 3);
    const second = await retriever.retrieve("a", query, [], 3);
    expect(first.memories.map(({ id }) => id)).toEqual(second.memories.map(({ id }) => id));
    expect(new Set(first.memories.map(({ kind }) => kind))).toEqual(new Set(["episodic", "semantic", "self-related"]));
    expect(first.memories.map(({ id }) => id)).not.toContain("rank-self-change");
    expect(first.memories.map(({ id }) => id)).not.toContain("rank-other-agent");
    expect(first.trace.find(({ memoryId }) => memoryId === "rank-semantic")?.matchedBy).toContain("subject");
    expect(first.trace.find(({ memoryId }) => memoryId === "rank-self")?.matchedBy).toContain("intention");
    const priority = await retriever.retrieve("a", { text: "", keywords: [], subjectIds: [], intentionIds: [], kinds: ["episodic"] }, [], 20);
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

  it("loads a complete Agent Core context from PostgreSQL without crossing Agent ownership", async () => {
    await pool.query("UPDATE agent_families SET base_instruction='' WHERE id='family'");
    await pool.query("INSERT INTO social_contexts(id,agent_id,subject_id,description) VALUES ('social-a','a','owner','Trusted'),('social-b','b','owner','Private') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO intentions(id,agent_id,description,reason,status) VALUES ('context-intention-a','a','Reply carefully','Conversation','active'),('context-intention-b','b','Keep private','Private','active') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO memory_subjects(memory_id,subject_id) VALUES ('memory-a1','owner') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO memory_intentions(memory_id,intention_id) VALUES ('memory-a1','context-intention-a') ON CONFLICT DO NOTHING");
    await pool.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ('recent-a','a','user-message',$1,'test','completed','2026-01-01'),('recent-b','b','user-message',$2,'test','completed','2026-01-01')", [JSON.stringify({ eventId: "recent-a", summary: "previous exchange", facts: ["prior context"], observedAt: fixtureInstant }), JSON.stringify({ eventId: "recent-b", summary: "private exchange", facts: ["other agent"], observedAt: fixtureInstant })]);
    const vector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const loader = new PostgresAgentContextLoader({
      pool, ids: new SequenceIdGenerator(["context-run"]), embedding: new FakeEmbeddingProvider({ hello: vector }), tools: new ToolRegistry([]),
      budget: { maxTokens: 10_000, maxMemories: 10, maxSocialContexts: 10 },
      limits: { deadlineMs: 1_000, maxSteps: 4, maxToolCalls: 0, maxHops: 4, maxAttempts: 3 }
    });
    const input = await loader.load({ id: "context-event", agentId: "a", kind: "user-message", occurredAt: fixtureInstant, payload: { text: "hello", transport: { hop: 2, expiresAt: "2026-01-02T00:00:00Z", replyTo: "discord:a" } } });
    expect(input.run).toMatchObject({ runId: "context-run", agentId: "a", transport: { hop: 2, replyTo: "discord:a" } });
    expect(input.self.id).toBe("a");
    expect(input.socialContext.map(({ id }) => id)).toContain("social-a");
    expect(input.socialContext.map(({ id }) => id)).not.toContain("social-b");
    expect(input.intentions.map(({ id }) => id)).toContain("context-intention-a");
    expect(input.intentions.map(({ id }) => id)).not.toContain("context-intention-b");
    expect(input.memories.every(({ agentId }) => agentId === "a")).toBe(true);
    expect(input.memories.find(({ id }) => id === "memory-a1")).toMatchObject({ relatedSubjectIds: ["owner"], relatedIntentionIds: ["context-intention-a"] });
    expect(input.recentObservations.map(({ eventId }) => eventId)).toContain("recent-a");
    expect(input.recentObservations.map(({ eventId }) => eventId)).not.toContain("recent-b");
    expect(input.runtimeConstraints.every((value) => value.length > 0)).toBe(true);
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

  it("claims each due intention once across scheduler instances", async () => {
    await pool.query("INSERT INTO intentions(id,agent_id,description,reason,status,next_review_at) VALUES ('due-1','a','Review goal','Due','active','2026-01-01')");
    await pool.query("INSERT INTO long_term_candidates(id,agent_id,target,proposed_value,status,reason,review_after) VALUES ('due-candidate','a','selfNarrative','Review me','pending','Due','2026-01-01')");
    const first = new PostgresScheduleRepository(pool); const second = new PostgresScheduleRepository(pool);
    const claims = await Promise.all([first.claimDue(new Date("2026-01-02T00:00:00Z"), 10), second.claimDue(new Date("2026-01-02T00:00:00Z"), 10)]);
    expect(claims.flat().map(({ id }) => id).sort()).toEqual(["due-1", "due-candidate"]);
    await first.complete({ id: "due-1", agentId: "a", kind: "intention", reason: "Review goal" }, null);
    await pool.query("UPDATE long_term_candidates SET status='kept' WHERE id='due-candidate'");
    await first.complete({ id: "due-candidate", agentId: "a", kind: "long-term-review", reason: "Due", candidateIds: ["due-candidate"] }, null);
    expect((await first.claimDue(new Date("2026-01-03T00:00:00Z"), 10))).toEqual([]);
  });

  it("shares correlation-loop and rate limits across Runtime instances", async () => {
    const first = new PostgresRuntimePersistence(pool, () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    const second = new PostgresRuntimePersistence(pool, () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    const event = { id: "policy-event-1", agentId: "a", kind: "external" as const, occurredAt: fixtureInstant, payload: {}, correlationId: "shared-correlation" };
    await expect(first.authorizeInbound(event, "policy-message-1", 10)).resolves.toBeUndefined();
    await expect(second.authorizeInbound({ ...event, id: "policy-event-2" }, "policy-message-2", 10)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(second.authorizeInbound({ ...event, id: "policy-event-3", correlationId: "rate-correlation-1" }, "policy-message-3", 1)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("activates event, idle and manual intention triggers and leases persistent drives once", async () => {
    await pool.query(`INSERT INTO intentions(id,agent_id,description,reason,trigger,status)
      VALUES ('trigger-event','a','React to plans','Test',$1,'active'),
             ('trigger-idle','a','Resume after idle','Test',$2,'active'),
             ('trigger-manual','a','Review manually','Test',$3,'active')`, [
      { kind: "event", eventKinds: ["user-message"], keywords: ["計画"] },
      { kind: "idle", idleForMs: 60_000 },
      { kind: "manual-review" }
    ]);
    const runtime = new PostgresRuntimePersistence(pool, () => Promise.resolve(agentCoreInputFixture()), new SequenceIdGenerator([]), () => new Date(fixtureInstant));
    await runtime.activateTriggers({ id: "trigger-source", agentId: "a", kind: "user-message", occurredAt: "2026-01-02T00:00:00Z", payload: { text: "計画を確認したい" } });
    expect((await pool.query<{ id: string; next_review_at: Date }>("SELECT id,next_review_at FROM intentions WHERE id IN ('trigger-event','trigger-idle') ORDER BY id")).rows.map(({ id, next_review_at }) => [id, next_review_at.toISOString()])).toEqual([
      ["trigger-event", "2026-01-02T00:00:00.000Z"], ["trigger-idle", "2026-01-02T00:01:00.000Z"]
    ]);
    await runtime.activateTriggers({ id: "manual-source", agentId: "a", kind: "system", occurredAt: "2026-01-02T00:02:00Z", payload: { manualReviewIntentionId: "trigger-manual" } });
    expect((await pool.query<{ next_review_at: Date }>("SELECT next_review_at FROM intentions WHERE id='trigger-manual'")).rows[0]?.next_review_at.toISOString()).toBe("2026-01-02T00:02:00.000Z");

    await pool.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ('drive:a:learn','a','persistent-drive','Learn','2026-01-01')");
    const first = new PostgresScheduleRepository(pool); const second = new PostgresScheduleRepository(pool);
    const claims = await Promise.all([first.claimDue(new Date("2026-01-03T00:00:00Z"), 10), second.claimDue(new Date("2026-01-03T00:00:00Z"), 10)]);
    expect(claims.flat().filter(({ id }) => id === "drive:a:learn")).toHaveLength(1);
    await first.complete({ id: "drive:a:learn", agentId: "a", kind: "persistent-drive", reason: "Learn" }, new Date("2026-01-04T00:00:00Z"));
  });

  it("updates long-term state, candidate and self-change memory atomically", async () => {
    await pool.query("INSERT INTO long_term_candidates(id,agent_id,target,proposed_value,status,reason) VALUES ('candidate-ok','a','selfNarrative','More patient','pending','Evidence'),('candidate-fail','a','selfNarrative','Should rollback','pending','Evidence')");
    await pool.query("INSERT INTO candidate_evidence(candidate_id,memory_id) VALUES ('candidate-ok','memory-a1'),('candidate-fail','memory-a1')");
    const selfChangeContent = "Changed selfNarrative from: Growing\nTo: I learn with patience";
    const selfChangeVector = Array.from({ length: 768 }, (_, index) => index === 2 ? 1 : 0);
    const selfChangeEmbedding = new PostgresMemoryEmbeddingLifecycle(pool, new FakeEmbeddingProvider({ [selfChangeContent]: selfChangeVector }), "review-fake");
    const repository = new PostgresLongTermReviewRepository(pool, () => "review-memory", selfChangeEmbedding);
    const service = new LongTermReviewService(repository, { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate-ok", decision: "UPDATE", reason: "Repeated experience" }], stateUpdate: { value: "I learn with patience", reason: "Repeated experience", evidenceMemoryIds: ["memory-a1"] } }) });
    await service.review("candidate-ok", new AbortController().signal);
    expect((await pool.query<{ self_narrative: string }>("SELECT self_narrative FROM agent_states WHERE agent_id='a'")).rows[0]?.self_narrative).toBe("I learn with patience");
    expect((await pool.query("SELECT 1 FROM memories WHERE id='review-memory' AND kind='self-change'")).rowCount).toBe(1);
    expect((await pool.query<{ embedding_status: string; embedding_model: string }>("SELECT embedding_status,embedding_model FROM memories WHERE id='review-memory'")).rows[0]).toEqual({ embedding_status: "ready", embedding_model: "review-fake" });
    const failing = new LongTermReviewService(new PostgresLongTermReviewRepository(pool, () => "review-memory"), { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate-fail", decision: "UPDATE", reason: "Test rollback" }], stateUpdate: { value: "Should rollback", reason: "Test rollback", evidenceMemoryIds: ["memory-a1"] } }) });
    await expect(failing.review("candidate-fail", new AbortController().signal)).rejects.toBeTruthy();
    expect((await pool.query<{ status: string }>("SELECT status FROM long_term_candidates WHERE id='candidate-fail'")).rows[0]?.status).toBe("pending");
    expect((await pool.query<{ self_narrative: string }>("SELECT self_narrative FROM agent_states WHERE agent_id='a'")).rows[0]?.self_narrative).toBe("I learn with patience");
  });

  it("reviews list-valued state and grounded memory targets without immediate re-claim", async () => {
    await pool.query("INSERT INTO long_term_candidates(id,agent_id,target,proposed_value,status,reason,review_after) VALUES ('candidate-role','a','role','Research partner','pending','Repeated collaboration','2026-01-01'),('candidate-semantic','a','semanticMemory','The user prefers concise plans','pending','Explicit repeated preference','2026-01-01')");
    await pool.query("INSERT INTO candidate_evidence(candidate_id,memory_id) VALUES ('candidate-role','memory-a1'),('candidate-semantic','memory-a1')");
    const ids = ["role-change-memory", "semantic-grounded-memory"];
    const repository = new PostgresLongTermReviewRepository(pool, () => ids.shift() ?? "unexpected");
    await new LongTermReviewService(repository, { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate-role", decision: "UPDATE", reason: "Stable role" }], stateUpdate: { value: "Research partner", reason: "Stable role", evidenceMemoryIds: ["memory-a1"] } }) }).review("candidate-role", new AbortController().signal);
    expect((await pool.query<{ roles: string[] }>("SELECT roles FROM agent_states WHERE agent_id='a'")).rows[0]?.roles).toEqual(["Research partner"]);
    await new LongTermReviewService(repository, { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate-semantic", decision: "UPDATE", reason: "Grounded fact" }], stateUpdate: { value: "The user prefers concise plans", reason: "Grounded fact", evidenceMemoryIds: ["memory-a1"] } }) }).review("candidate-semantic", new AbortController().signal);
    expect((await pool.query<{ evidence_memory_ids: string[] }>("SELECT evidence_memory_ids FROM memories WHERE id='semantic-grounded-memory' AND kind='semantic'")).rows[0]?.evidence_memory_ids).toEqual(["memory-a1"]);

    await pool.query("INSERT INTO long_term_candidates(id,agent_id,target,proposed_value,status,reason,review_after) VALUES ('candidate-keep','a','longTermInterest','Distributed systems','pending','Needs more evidence','2026-01-01')");
    await pool.query("INSERT INTO candidate_evidence(candidate_id,memory_id) VALUES ('candidate-keep','memory-a1')");
    await new LongTermReviewService(repository, { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate-keep", decision: "KEEP", reason: "Wait for repetition" }] }) }).review("candidate-keep", new AbortController().signal);
    const kept = (await pool.query<{ status: string; review_after: Date }>("SELECT status,review_after FROM long_term_candidates WHERE id='candidate-keep'")).rows[0];
    expect(kept?.status).toBe("pending"); expect(kept?.review_after).toBeInstanceOf(Date);
  });

  it("materializes normal Core proposals and Tool execution records with Runtime-owned metadata", async () => {
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,evidence_event_ids) VALUES ('proposal-evidence','a','self-related','Repeated follow-through','Relevant',now(),'[]')");
    await pool.query("INSERT INTO intentions(id,agent_id,description,reason,status) VALUES ('existing-intention','a','Old goal','Existing','active')");
    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const input = agentCoreInputFixture();
    input.run = { runId: "runtime-run", eventId: "runtime-event", agentId: "a", occurredAt: fixtureInstant };
    input.self = { ...input.self, id: "a", version };
    input.dynamicState = { ...input.dynamicState, agentId: "a" };
    input.memories = [{ id: "proposal-evidence", agentId: "a", kind: "self-related", content: "Repeated follow-through", createdAt: fixtureInstant, relatedSubjectIds: [], relatedIntentionIds: [], importance: "Relevant", retrievalPriority: "normal", evidenceEventIds: [] }];
    input.intentions = [{ id: "existing-intention", agentId: "a", description: "Old goal", status: "active", reason: "Existing", createdAt: fixtureInstant, updatedAt: fixtureInstant }];
    input.availableTools = [{ name: "lookup", description: "Lookup", inputSchema: {} }];
    input.memoryRetrievalTrace = [{ memoryId: "proposal-evidence", finalRank: 1, matchedBy: ["subject", "recency"], kind: "self-related", selected: true }];
    const memoryVector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const memoryEmbedding = new PostgresMemoryEmbeddingLifecycle(pool, new FakeEmbeddingProvider({ "A useful exchange": memoryVector }), "runtime-fake");
    const persistence = new PostgresRuntimePersistence(pool, () => Promise.resolve(input), new SequenceIdGenerator(["memory-new", "intention-new", "candidate-new", "tool-record", "state-change", "social-change"]), () => new Date(fixtureInstant), memoryEmbedding);
    const message = messageFixture({ id: "runtime-message", destination: "agent:a" });
    const event = { id: "runtime-event", agentId: "a", kind: "user-message" as const, occurredAt: fixtureInstant, payload: { text: "hello" }, causationId: "incoming-message", correlationId: "conversation-1" };
    const result = {
      output: { interpretation: {}, internalChanges: {
        transientStateUpdates: [{ target: "mood" as const, operation: "set" as const, value: "Attentive", reason: "Conversation", evidenceIds: [] }, { target: "socialContext" as const, operation: "set" as const, value: { subjectId: "owner", description: "Trusted collaborator" }, reason: "Conversation", evidenceIds: [] }],
        memoryProposals: [{ kind: "episodic" as const, content: "A useful exchange", relatedSubjectIds: ["owner"], relatedIntentionIds: ["existing-intention"], importance: "Useful", retrievalPriority: "normal" as const, evidenceEventIds: ["runtime-event"] }, { kind: "episodic" as const, content: "A useful exchange", relatedSubjectIds: ["owner"], relatedIntentionIds: ["existing-intention"], importance: "Useful", retrievalPriority: "normal" as const, evidenceEventIds: ["runtime-event"] }],
        intentionProposals: [{ operation: "create" as const, description: "Follow up", reason: "Still relevant" }, { operation: "update" as const, intentionId: "existing-intention", status: "completed" as const, reason: "Finished" }],
        longTermCandidates: [{ target: "selfNarrative" as const, proposal: "I follow through", reason: "Repeated evidence", evidenceMemoryIds: ["proposal-evidence"], evidenceEventIds: [] }, { target: "selfNarrative" as const, proposal: "I follow through", reason: "Repeated evidence", evidenceMemoryIds: ["proposal-evidence"], evidenceEventIds: [] }]
      }, action: { type: "respond" as const, content: "Hello" } },
      toolExecutions: [{ callId: "tool-1", runId: "runtime-run", eventId: "runtime-event", name: "lookup", input: { q: "x" }, ok: true, result: { answer: 1 }, startedAt: fixtureInstant, finishedAt: fixtureInstant }]
    };
    await expect(persistence.commit(message, event, input, result, { state: { ...input.dynamicState, mood: "Attentive" }, changes: [{ target: "mood", operation: "set", before: input.dynamicState.mood, after: "Attentive", reason: "Conversation", evidenceIds: [] }, { target: "socialContext", operation: "set", before: undefined, after: { subjectId: "owner", description: "Trusted collaborator" }, reason: "Conversation", evidenceIds: [] }] }, [])).resolves.toBe("committed");
    expect((await pool.query<{ agent_id: string }>("SELECT agent_id FROM memories WHERE id='memory-new'")).rows[0]?.agent_id).toBe("a");
    expect((await pool.query<{ embedding_status: string; embedding_model: string }>("SELECT embedding_status,embedding_model FROM memories WHERE id='memory-new'")).rows[0]).toEqual({ embedding_status: "ready", embedding_model: "runtime-fake" });
    expect((await pool.query<{ status: string }>("SELECT status FROM intentions WHERE id='existing-intention'")).rows[0]?.status).toBe("completed");
    expect((await pool.query<{ agent_id: string; status: string }>("SELECT agent_id,status FROM long_term_candidates WHERE id='candidate-new'")).rows[0]).toMatchObject({ agent_id: "a", status: "pending" });
    expect((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM memories WHERE evidence_event_ids ? 'runtime-event' AND content='A useful exchange'")).rows[0]?.count).toBe("1");
    expect((await pool.query<{ count: string }>("SELECT count(*)::text AS count FROM long_term_candidates WHERE proposed_value='I follow through'")).rows[0]?.count).toBe("1");
    expect((await pool.query<{ event_id: string; tool: string }>("SELECT event_id,tool FROM tool_executions WHERE id='tool-record'")).rows[0]).toEqual({ event_id: "runtime-event", tool: "lookup" });
    expect((await pool.query<{ causation_id: string; correlation_id: string }>("SELECT causation_id,correlation_id FROM events WHERE id='runtime-event'")).rows[0]).toEqual({ causation_id: "incoming-message", correlation_id: "conversation-1" });
    expect((await pool.query<{ kind: string; causation_id: string; correlation_id: string }>("SELECT kind,causation_id,correlation_id FROM events WHERE id='runtime-event:tool-result:tool-1'")).rows[0]).toEqual({ kind: "tool-result", causation_id: "runtime-event", correlation_id: "conversation-1" });
    expect((await pool.query<{ result_event_id: string }>("SELECT result_event_id FROM tool_executions WHERE id='tool-record'")).rows[0]?.result_event_id).toBe("runtime-event:tool-result:tool-1");
    expect((await pool.query<{ description: string }>("SELECT description FROM social_contexts WHERE agent_id='a' AND subject_id='owner'")).rows[0]?.description).toBe("Trusted collaborator");
    expect((await pool.query<{ result: { memoryRetrievalTrace?: unknown[] } }>("SELECT result FROM agent_runs WHERE id='runtime-run'")).rows[0]?.result.memoryRetrievalTrace).toEqual(input.memoryRetrievalTrace);
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
