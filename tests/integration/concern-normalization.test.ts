import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { DomainError } from "../../src/domain/contracts.js";
import { PostgresConcernNormalizationRepository } from "../../src/infrastructure/persistence/postgres-concern-normalization.js";
import { createRuntimeDatabase } from "../../src/infrastructure/persistence/runtime-database.js";
import { createIntegrationDatabase, integrationDatabaseConfigured } from "../support/integration-database.js";

const describeDatabase = integrationDatabaseConfigured() ? describe : describe.skip;

describeDatabase("Concern normalization persistence", () => {
  const database = createIntegrationDatabase();
  const repository = new PostgresConcernNormalizationRepository(createRuntimeDatabase(database.pool));

  beforeAll(async () => {
    await database.prepare();
    await database.pool.query("INSERT INTO agent_families(id,name,shared_disposition,base_instruction) VALUES ('family','Family','Curious','Observe')");
    await database.pool.query("INSERT INTO agents(id,family_id,identity,initial_disposition) VALUES ('aka','family','Aka','Curious')");
    await database.pool.query("INSERT INTO agent_states(agent_id,disposition,self_story,commitments,concerns,relationships,mood,version) VALUES ('aka','Curious','Story','[]',$1,'[]','Alert',3)", [JSON.stringify([
      { id: "active-change", description: "長い経緯", whyItMatters: "長い理由", status: "active", reconsiderAt: "2026-12-01T00:00:00.000Z" },
      { id: "active-keep", description: "短い関心", whyItMatters: "短い理由", status: "active" },
      { id: "closed", description: "終了済み", whyItMatters: "終了", status: "satisfied" }
    ])]);
  });

  afterAll(async () => { await database.close(); });

  it("FR-8, NFR-7, NFR-8: atomically normalizes active Concern text and audits only changed records", async () => {
    const snapshot = await repository.loadActive("aka");
    expect(snapshot.version).toBe(3);
    expect(snapshot.concerns.map(({ id }) => id)).toEqual(["active-change", "active-keep"]);
    const occurredAt = new Date("2026-11-22T01:02:03.000Z");

    await expect(repository.apply({ agentId: "aka", expectedVersion: 3, runId: "normalize-run", occurredAt, changes: [{ concernId: "active-change", description: "記憶の変質条件が気になる", whyItMatters: "曖昧さへの好奇心が残る" }] })).resolves.toBe(4);

    const row = (await database.pool.query<{ version: number; concerns: { id: string; description: string; whyItMatters: string; status: string; reconsiderAt?: string }[] }>("SELECT version,concerns FROM agent_states WHERE agent_id='aka'")).rows[0];
    expect(row?.version).toBe(4);
    expect(row?.concerns).toEqual([
      { id: "active-change", description: "記憶の変質条件が気になる", whyItMatters: "曖昧さへの好奇心が残る", status: "active", reconsiderAt: "2026-12-01T00:00:00.000Z" },
      { id: "active-keep", description: "短い関心", whyItMatters: "短い理由", status: "active" },
      { id: "closed", description: "終了済み", whyItMatters: "終了", status: "satisfied" }
    ]);
    expect((await database.pool.query("SELECT id,concern_id,kind,occurred_at FROM concern_activities WHERE agent_id='aka'")).rows).toEqual([{ id: "concern-normalization:normalize-run:0:active-change", concern_id: "active-change", kind: "reviewed", occurred_at: occurredAt }]);
  });

  it("NFR-8: rejects a stale version without updating state or audit records", async () => {
    await expect(repository.apply({ agentId: "aka", expectedVersion: 3, runId: "stale-run", occurredAt: new Date(), changes: [{ concernId: "active-keep", description: "変更不可", whyItMatters: "競合" }] })).rejects.toEqual(expect.objectContaining<Partial<DomainError>>({ code: "CONFLICT" }));
    expect((await database.pool.query<{ version: number }>("SELECT version FROM agent_states WHERE agent_id='aka'")).rows[0]?.version).toBe(4);
    expect((await database.pool.query<{ count: string }>("SELECT count(*)::text AS count FROM concern_activities WHERE id LIKE 'concern-normalization:stale-run:%'")).rows[0]?.count).toBe("0");
  });
});
