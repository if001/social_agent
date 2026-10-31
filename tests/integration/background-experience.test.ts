import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { parse } from "dotenv";
import { Pool } from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { BackgroundExperienceFile } from "../../src/domain/contracts.js";
import { PostgresRetrievalService } from "../../src/infrastructure/persistence/postgres-retrieval-service.js";
import { migrate } from "../../src/infrastructure/persistence/postgres.js";
import { replaceBackgroundExperiences } from "../../src/operations/background-experiences.js";
import { createAgentContextTools } from "../../src/infrastructure/tools/agent-context-tools.js";
import { FakeEmbeddingProvider } from "../../src/infrastructure/embedding/ollama-embedding.js";
import { initializeAgent } from "../../src/operations/operations.js";

const sample = parse(await readFile(new URL("../../.env.sample", import.meta.url)));
const databaseUrl = (process.env.TEST_POSTGRES_URL ?? process.env.POSTGRES_URL ?? sample.POSTGRES_URL)?.replace("postgresql+psycopg://", "postgresql://");
const describeDatabase = databaseUrl === undefined ? describe.skip : describe;

const file = (experiences: BackgroundExperienceFile["experiences"]): BackgroundExperienceFile => ({
  version: 1,
  agentId: "a",
  profile: { birthYear: 1990, currentAge: 35, birthplace: "神奈川", currentCity: "東京", occupation: "編集者", family: ["母"], closePeople: ["友人"], values: ["誠実さ"], recurringTopics: ["本"], communicationHabits: ["結論から話す"] },
  experiences
});

const experience = (id: string, occurredAt: string, age: number, overrides: Partial<BackgroundExperienceFile["experiences"][number]> = {}) => ({
  id, occurredAt, age, place: "東京", participants: ["友人"], relationship: "友人", action: "街を歩いた", feeling: "落ち着いた", outcome: "店を見つけた", lesson: "歩くと発見がある", importance: "普通", tags: ["散歩"], ...overrides
});

describeDatabase("Background Experience persistence and retrieval", () => {
  const schema = `test_${randomUUID().replaceAll("-", "")}`;
  const control = new Pool({ connectionString: databaseUrl, max: 2 });
  const pool = new Pool({ connectionString: databaseUrl, options: `-c search_path=${schema},public,ext`, max: 4 });

  beforeAll(async () => {
    await control.query(`CREATE SCHEMA ${schema}`);
    await migrate(pool);
    await pool.query("INSERT INTO agent_families(id,name,shared_disposition,base_instruction) VALUES ('family','Family','Curious','Help')");
    await pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ('a','family','Agent A','Calm'),('b','family','Agent B','Bold')");
    for (const agentId of ["a", "b"]) await pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,concerns,relationships,mood) VALUES ($1,'Careful learner','Growing continuously','[]','[]','[]','Calm')", [agentId]);
  });
  afterAll(async () => {
    await pool.end();
    await control.query(`DROP SCHEMA ${schema} CASCADE`);
    await control.end();
  });

  it("FR-53, FR-54, NFR-19: replaces only background experiences and preserves conversation memory", async () => {
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,retrieval_priority,occurred_at,created_at,embedding_status) VALUES ('m1','a','episodic','東京で友人と話した','普通','normal',now(),now(),'pending')");
    await expect(replaceBackgroundExperiences(pool, file([
      experience("e1", "2018-04-01T00:00:00+09:00", 28, { tags: ["散歩", "発見"], importance: "高い" }),
      experience("e2", "2020-04-01T00:00:00+09:00", 30, { place: "横浜", tags: ["仕事", "学び"] })
    ]), "a")).resolves.toBe(2);
    expect((await pool.query("SELECT count(*)::int AS count FROM background_experiences WHERE agent_id='a'")).rows[0]).toEqual({ count: 2 });
    expect((await pool.query("SELECT count(*)::int AS count FROM memories WHERE agent_id='a'")).rows[0]).toEqual({ count: 1 });
    await expect(replaceBackgroundExperiences(pool, file([experience("e3", "2021-04-01T00:00:00+09:00", 31, { tags: ["仕事"] })]), "a")).resolves.toBe(1);
    expect((await pool.query("SELECT count(*)::int AS count FROM background_experiences WHERE agent_id='a'")).rows[0]).toEqual({ count: 1 });
    expect((await pool.query("SELECT count(*)::int AS count FROM memories WHERE agent_id='a'")).rows[0]).toEqual({ count: 1 });
    await expect(replaceBackgroundExperiences(pool, file([experience("e4", "2022-04-01T00:00:00+09:00", 32, { tags: ["仕事"] })]), "b")).rejects.toThrow(/target agent/);
    expect((await pool.query("SELECT count(*)::int AS count FROM background_experiences WHERE agent_id='a'")).rows[0]).toEqual({ count: 1 });
  });

  it("FR-55, AC-14, NFR-14: retrieves conversation memory and background experience with the common ranking", async () => {
    await replaceBackgroundExperiences(pool, file([experience("e1", "2020-04-01T00:00:00+09:00", 30, { tags: ["散歩", "発見"], action: "東京の街を歩いた" })]), "a");
    const service = new PostgresRetrievalService(pool);
    const all = await service.retrieve({ agentId: "a", query: "東京", scope: "all", limit: 5 });
    expect(all.map(({ source }) => source)).toEqual(expect.arrayContaining(["conversation", "background"]));
    expect(all.find(({ source }) => source === "background")?.matchedBy).toContain("keyword");
    expect((await service.retrieve({ agentId: "a", query: "東京", scope: "background", limit: 5 })).every(({ source }) => source === "background")).toBe(true);
    expect((await service.retrieve({ agentId: "a", query: "東京", scope: "conversation", limit: 5 })).every(({ source }) => source === "conversation")).toBe(true);
    expect(await service.retrieve({ agentId: "b", query: "東京", scope: "all", limit: 5 })).toEqual([]);

    const tool = createAgentContextTools(pool, service).find(({ name }) => name === "retrieval_search");
    const result = await tool?.execute({ query: "東京", scope: "all", limit: 5 }, { agentId: "a", runId: "run", idempotencyKey: "retrieval" }, new AbortController().signal);
    expect(result?.ok).toBe(true);
    if (result?.ok !== true || typeof result.value !== "object" || result.value === null || !("items" in result.value)) throw new Error("Expected retrieval items");
    expect((result.value as { items: { source: string }[] }).items.map(({ source }) => source)).toEqual(expect.arrayContaining(["conversation", "background"]));
  });

  it("FR-53, NFR-19: re-initialization replaces background experiences but preserves conversation memory", async () => {
    const config = {
      version: 1 as const,
      family: { id: "family", name: "Family", sharedDisposition: "Curious", baseInstruction: "Help" },
      agent: { id: "a", identity: "Agent A", initialDisposition: "Calm", selfNarrative: "Growing", selfContinuity: "Continuous" },
      initialState: { mood: "Calm", concerns: [], relationships: [] }
    };
    const timings = { autonomyReviewIntervalMs: 86_400_000, stateReviewIntervalMs: 86_400_000, memoryRecallIntervalMs: 604_800_000 };
    const before = (await pool.query<{ count: number }>("SELECT count(*)::int AS count FROM memories WHERE agent_id='a'")).rows[0];
    await initializeAgent(pool, config, timings, { backgroundExperience: file([experience("i1", "2019-04-01T00:00:00+09:00", 29, { action: "初期化前の経験" })]) });
    await initializeAgent(pool, config, timings, { backgroundExperience: file([experience("i2", "2021-04-01T00:00:00+09:00", 31, { action: "再初期化後の経験" })]) });
    expect((await pool.query("SELECT count(*)::int AS count FROM memories WHERE agent_id='a'")).rows[0]).toEqual(before);
    const background = await pool.query<{ id: string }>("SELECT id FROM background_experiences WHERE agent_id='a'");
    expect(background.rows).toEqual([{ id: "i2" }]);
  });

  it("FR-55, AC-14: ranks vector, subject and recency for conversation memory", async () => {
    const vector = Array.from({ length: 768 }, (_, index) => index === 0 ? 1 : 0);
    const opposite = Array.from({ length: 768 }, (_, index) => index === 1 ? 1 : 0);
    await pool.query("INSERT INTO memories(id,agent_id,kind,content,importance,retrieval_priority,occurred_at,embedding,embedding_model,embedding_status) VALUES ('vec','a','semantic','vector target','普通','normal','2024-01-01',$1::vector,'fake','ready'),('old','a','episodic','old memory','普通','normal','2020-01-01',$2::vector,'fake','ready'),('subject','a','semantic','subject fact','普通','normal','2022-01-01',NULL,NULL,'pending')", [`[${vector.join(",")}]`, `[${opposite.join(",")}]`]);
    await pool.query("INSERT INTO memory_subjects(memory_id,subject_id) VALUES ('vec','owner'),('subject','owner')");
    const service = new PostgresRetrievalService(pool, new FakeEmbeddingProvider({ "vector query": vector }, 768));
    const vectorRanked = await service.retrieve({ agentId: "a", query: "vector query", scope: "conversation", limit: 5 });
    expect(vectorRanked[0]).toMatchObject({ id: "vec" });
    expect(vectorRanked[0]?.matchedBy).toContain("vector");
    const subjectRanked = await service.retrieve({ agentId: "a", query: "", scope: "conversation", subjectIds: ["owner"], subjectFilter: true, limit: 5 });
    expect(subjectRanked.map(({ id }) => id)).toEqual(expect.arrayContaining(["vec", "subject"]));
    expect(subjectRanked.find(({ id }) => id === "subject")?.matchedBy).toContain("subject");
    const recent = await service.retrieve({ agentId: "a", query: "", scope: "conversation", limit: 5 });
    expect(recent.findIndex(({ id }) => id === "vec")).toBeLessThan(recent.findIndex(({ id }) => id === "subject"));
    expect(recent.findIndex(({ id }) => id === "subject")).toBeLessThan(recent.findIndex(({ id }) => id === "old"));
  });
});
