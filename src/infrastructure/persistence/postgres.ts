import { fileURLToPath } from "node:url";

import type { Pool, QueryResultRow } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, eq, sql } from "drizzle-orm";
import { migrate as runDrizzleMigrations } from "drizzle-orm/node-postgres/migrator";

import { DomainError } from "../../domain/contracts.js";
import * as schema from "./schema.js";
import { createRuntimeDatabase, type RuntimeDatabase } from "./runtime-database.js";
import { ConcernRepository } from "./concern-repository.js";

export async function migrate(pool: Pool, migrationsFolder = fileURLToPath(new URL("../../../drizzle", import.meta.url))): Promise<void> {
  const result = await pool.query<{ schema: string }>("SELECT current_schema() AS schema");
  const migrationsSchema = result.rows[0]?.schema;
  if (migrationsSchema === undefined) throw new Error("PostgreSQL current schema is unavailable");
  await runDrizzleMigrations(drizzle(pool, { schema }), { migrationsFolder, migrationsSchema });
}

export class PostgresUnitOfWork {
  readonly database: RuntimeDatabase;
  readonly native: Pool;
  constructor(pool: Pool) { this.native = pool; this.database = createRuntimeDatabase(pool); }
  transaction<T>(work: Parameters<RuntimeDatabase["transaction"]>[0]): Promise<T> {
    return this.database.transaction(work) as Promise<T>;
  }
}

export class AgentStateRepository {
  constructor(private readonly client: RuntimeDatabase["db"] | Parameters<Parameters<RuntimeDatabase["transaction"]>[0]>[0]) {}
  async find<T extends QueryResultRow>(agentId: string): Promise<T | undefined> {
    return (await this.client.select().from(schema.agentStates).where(eq(schema.agentStates.agentId, agentId)).limit(1))[0] as T | undefined;
  }
  async update(agentId: string, expectedVersion: number, values: Readonly<Record<string, unknown>>): Promise<number> {
    const allowed = ["disposition", "self_story", "commitments", "concerns", "relationships", "mood"];
    const entries = Object.entries(values).filter(([key]) => allowed.includes(key));
    if (entries.length !== Object.keys(values).length || entries.length === 0) throw new DomainError("VALIDATION", "Invalid state fields");
    const columnMap = { disposition: "disposition", self_story: "selfStory", commitments: "commitments", relationships: "relationships", mood: "mood" } as const;
    const update: Record<string, unknown> = { version: sql`${schema.agentStates.version}+1`, updatedAt: new Date() };
    for (const [key, value] of entries) if (key !== "concerns") update[columnMap[key as keyof typeof columnMap]] = value;
    const result = await this.client.update(schema.agentStates).set(update).where(and(eq(schema.agentStates.agentId, agentId), eq(schema.agentStates.version, expectedVersion))).returning({ version: schema.agentStates.version });
    const version = result[0]?.version;
    if (version === undefined) throw new DomainError("CONFLICT", "Agent state version conflict");
    if ("concerns" in values) await new ConcernRepository(this.client).replace(agentId, values.concerns);
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
