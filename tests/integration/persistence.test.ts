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

const sample = parse(await readFile(new URL("../../.env.sample", import.meta.url)));
const databaseUrl = process.env.TEST_POSTGRES_URL ?? sample.POSTGRES_URL?.replace("postgresql+psycopg://", "postgresql://");
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
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,embedding,embedding_model) VALUES ('memory-a1','a','semantic','typescript architecture','Relevant','2026-01-02',$1::vector,'test'),('memory-a2','a','episodic','unrelated note','Relevant','2026-01-01',$2::vector,'test'),('memory-b1','b','semantic','typescript secret','Relevant','2026-01-03',$1::vector,'test')", [`[${unit.join(",")}]`, `[${opposite.join(",")}]`]);
    const retriever = new PostgresMemoryRetriever(pool);
    const found = await retriever.retrieve("a", "typescript", unit, 5, { kinds: ["semantic"] });
    expect(found.map(({ id }) => id)).toEqual(["memory-a1"]);
    expect(found.every(({ agentId }) => agentId === "a")).toBe(true);
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

  it("updates long-term state, candidate and self-change memory atomically", async () => {
    await pool.query("INSERT INTO long_term_candidates(id,agent_id,target,proposed_value,status,reason) VALUES ('candidate-ok','a','selfNarrative','More patient','pending','Evidence'),('candidate-fail','a','selfNarrative','Should rollback','pending','Evidence')");
    await pool.query("INSERT INTO candidate_evidence(candidate_id,memory_id) VALUES ('candidate-ok','memory-a1'),('candidate-fail','memory-a1')");
    const repository = new PostgresLongTermReviewRepository(pool, () => "review-memory");
    const service = new LongTermReviewService(repository, { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate-ok", decision: "UPDATE", reason: "Repeated experience" }], stateUpdate: { value: "I learn with patience", reason: "Repeated experience", evidenceMemoryIds: ["memory-a1"] } }) });
    await service.review("candidate-ok", new AbortController().signal);
    expect((await pool.query<{ self_narrative: string }>("SELECT self_narrative FROM agent_states WHERE agent_id='a'")).rows[0]?.self_narrative).toBe("I learn with patience");
    expect((await pool.query("SELECT 1 FROM memories WHERE id='review-memory' AND kind='self-change'")).rowCount).toBe(1);
    const failing = new LongTermReviewService(new PostgresLongTermReviewRepository(pool, () => "review-memory"), { review: () => Promise.resolve({ decisions: [{ candidateId: "candidate-fail", decision: "UPDATE", reason: "Test rollback" }], stateUpdate: { value: "Should rollback", reason: "Test rollback", evidenceMemoryIds: ["memory-a1"] } }) });
    await expect(failing.review("candidate-fail", new AbortController().signal)).rejects.toBeTruthy();
    expect((await pool.query<{ status: string }>("SELECT status FROM long_term_candidates WHERE id='candidate-fail'")).rows[0]?.status).toBe("pending");
    expect((await pool.query<{ self_narrative: string }>("SELECT self_narrative FROM agent_states WHERE agent_id='a'")).rows[0]?.self_narrative).toBe("I learn with patience");
  });

  it("materializes normal Core proposals and Tool execution records with Runtime-owned metadata", async () => {
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,occurred_at,evidence_event_ids) VALUES ('proposal-evidence','a','self-related','Repeated follow-through','Relevant',now(),'[]')");
    await pool.query("INSERT INTO intentions(id,agent_id,description,reason,status) VALUES ('existing-intention','a','Old goal','Existing','active')");
    const version = (await pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='a'")).rows[0]?.version ?? 0;
    const input = agentCoreInputFixture();
    input.run = { runId: "runtime-run", eventId: "runtime-event", agentId: "a", occurredAt: fixtureInstant };
    input.self = { ...input.self, id: "a", version };
    input.dynamicState = { ...input.dynamicState, agentId: "a" };
    input.memories = [{ id: "proposal-evidence", agentId: "a", kind: "self-related", content: "Repeated follow-through", createdAt: fixtureInstant, relatedSubjectIds: [], relatedIntentionIds: [], importance: "Relevant", evidenceEventIds: [] }];
    input.intentions = [{ id: "existing-intention", agentId: "a", description: "Old goal", status: "active", reason: "Existing", createdAt: fixtureInstant, updatedAt: fixtureInstant }];
    input.availableTools = [{ name: "lookup", description: "Lookup", inputSchema: {} }];
    const persistence = new PostgresRuntimePersistence(pool, () => Promise.resolve(input), new SequenceIdGenerator(["memory-new", "intention-new", "candidate-new", "tool-record", "state-change", "social-change"]), () => new Date(fixtureInstant));
    const message = messageFixture({ id: "runtime-message", destination: "agent:a" });
    const event = { id: "runtime-event", agentId: "a", kind: "user-message" as const, occurredAt: fixtureInstant, payload: { text: "hello" } };
    const result = {
      output: { interpretation: {}, internalChanges: {
        transientStateUpdates: [{ target: "mood" as const, operation: "set" as const, value: "Attentive", reason: "Conversation", evidenceIds: [] }, { target: "socialContext" as const, operation: "set" as const, value: { subjectId: "owner", description: "Trusted collaborator" }, reason: "Conversation", evidenceIds: [] }],
        memoryProposals: [{ kind: "episodic" as const, content: "A useful exchange", relatedSubjectIds: ["owner"], relatedIntentionIds: ["existing-intention"], importance: "Useful", evidenceEventIds: ["runtime-event"] }],
        intentionProposals: [{ operation: "create" as const, description: "Follow up", reason: "Still relevant" }, { operation: "update" as const, intentionId: "existing-intention", status: "completed" as const, reason: "Finished" }],
        longTermCandidates: [{ target: "selfNarrative" as const, proposal: "I follow through", reason: "Repeated evidence", evidenceMemoryIds: ["proposal-evidence"] }]
      }, action: { type: "respond" as const, content: "Hello" } },
      toolExecutions: [{ callId: "tool-1", runId: "runtime-run", eventId: "runtime-event", name: "lookup", input: { q: "x" }, ok: true, result: { answer: 1 }, startedAt: fixtureInstant, finishedAt: fixtureInstant }]
    };
    await expect(persistence.commit(message, event, input, result, { state: { ...input.dynamicState, mood: "Attentive" }, changes: [{ target: "mood", operation: "set", before: input.dynamicState.mood, after: "Attentive", reason: "Conversation", evidenceIds: [] }, { target: "socialContext", operation: "set", before: undefined, after: { subjectId: "owner", description: "Trusted collaborator" }, reason: "Conversation", evidenceIds: [] }] }, [])).resolves.toBe("committed");
    expect((await pool.query<{ agent_id: string }>("SELECT agent_id FROM memories WHERE id='memory-new'")).rows[0]?.agent_id).toBe("a");
    expect((await pool.query<{ status: string }>("SELECT status FROM intentions WHERE id='existing-intention'")).rows[0]?.status).toBe("completed");
    expect((await pool.query<{ agent_id: string; status: string }>("SELECT agent_id,status FROM long_term_candidates WHERE id='candidate-new'")).rows[0]).toMatchObject({ agent_id: "a", status: "pending" });
    expect((await pool.query<{ event_id: string; tool: string }>("SELECT event_id,tool FROM tool_executions WHERE id='tool-record'")).rows[0]).toEqual({ event_id: "runtime-event", tool: "lookup" });
    expect((await pool.query<{ description: string }>("SELECT description FROM social_contexts WHERE agent_id='a' AND subject_id='owner'")).rows[0]?.description).toBe("Trusted collaborator");
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
