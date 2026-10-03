import { readFile } from "node:fs/promises";

import type { Pool, PoolClient, QueryResultRow } from "pg";

import { DomainError } from "../../domain/contracts.js";

export async function migrate(pool: Pool, path = new URL("../../../drizzle/0000_persistence_foundation.sql", import.meta.url)): Promise<void> {
  await pool.query(await readFile(path, "utf8"));
}

export class PostgresUnitOfWork {
  constructor(private readonly pool: Pool) {}
  async transaction<T>(work: (client: PoolClient) => Promise<T>): Promise<T> {
    const client = await this.pool.connect();
    try { await client.query("BEGIN"); const result = await work(client); await client.query("COMMIT"); return result; }
    catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  }
}

export class AgentStateRepository {
  constructor(private readonly client: Pick<Pool, "query"> | Pick<PoolClient, "query">) {}
  async find<T extends QueryResultRow>(agentId: string): Promise<T | undefined> {
    const result = await this.client.query<T>("SELECT * FROM agent_states WHERE agent_id = $1", [agentId]);
    return result.rows[0];
  }
  async update(agentId: string, expectedVersion: number, values: Readonly<Record<string, unknown>>): Promise<number> {
    const allowed = ["acquired_disposition", "values", "roles", "interests", "preferences", "raison_detre", "self_narrative", "self_continuity", "emotion", "mood", "drives", "desires", "current_interests"];
    const entries = Object.entries(values).filter(([key]) => allowed.includes(key));
    if (entries.length !== Object.keys(values).length || entries.length === 0) throw new DomainError("VALIDATION", "Invalid state fields");
    const assignments = entries.map(([key], index) => `${key} = $${String(index + 3)}`).join(", ");
    const jsonFields = new Set(["roles", "interests", "preferences", "drives", "desires", "current_interests"]);
    const result = await this.client.query<{ version: number }>(`UPDATE agent_states SET ${assignments}, version = version + 1, updated_at = now() WHERE agent_id = $1 AND version = $2 RETURNING version`, [agentId, expectedVersion, ...entries.map(([key, value]) => jsonFields.has(key) ? JSON.stringify(value) : value)]);
    const version = result.rows[0]?.version;
    if (version === undefined) throw new DomainError("CONFLICT", "Agent state version conflict");
    return version;
  }
}

export async function withAgentLock<T>(pool: Pool, lockKey: number, work: () => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    const acquired = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1) AS acquired", [lockKey]);
    if (acquired.rows[0]?.acquired !== true) throw new DomainError("CONFLICT", "Agent is locked by another process");
    return await work();
  } finally {
    await client.query("SELECT pg_advisory_unlock($1)", [lockKey]).catch(() => undefined);
    client.release();
  }
}
