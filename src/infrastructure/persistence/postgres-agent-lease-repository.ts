import { createHash } from "node:crypto";

import { eq } from "drizzle-orm";
import type { PoolClient } from "pg";

import { DomainError } from "../../domain/contracts.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { advisoryLocks, agents, autonomousSchedules } from "./schema.js";

const agentLockKey = (agentId: string): bigint => createHash("sha256").update(agentId).digest().readBigInt64BE();

/** Owns process-level Agent liveness and PostgreSQL advisory-lock operations. */
export class PostgresAgentLeaseRepository {
  constructor(private readonly database: RuntimeDatabase) {}

  async assertReady(agentId: string): Promise<void> {
    // PostgreSQL-native health probe; keeping the driver error intact makes
    // startup failures observable without an ORM wrapper replacing the cause.
    await this.database.native.query("SELECT 1");
    const agent = await this.database.db.select({ active: agents.active }).from(agents).where(eq(agents.id, agentId)).limit(1);
    if (agent[0]?.active !== true) throw new DomainError("NOT_FOUND", `Active Agent not found: ${agentId}`);
  }

  async ensureConcernFormation(agentId: string, intervalMs: number): Promise<void> {
    const agent = await this.database.db.select({ id: agents.id }).from(agents).where(eq(agents.id, agentId)).limit(1);
    if (agent[0] === undefined) return;
    await this.database.db.insert(autonomousSchedules).values({ id: `concern-formation:${agentId}`, agentId, kind: "concern-formation", reason: "Self、経験、関係、探索領域から今後も残る関心を形成する", nextDueAt: new Date(Date.now() + intervalMs) }).onConflictDoNothing({ target: autonomousSchedules.id });
  }

  async acquire(agentId: string): Promise<PoolClient> {
    const client = await this.database.native.connect();
    try {
      const db = this.database.db;
      await db.insert(advisoryLocks).values({ agentId, lockKey: agentLockKey(agentId) }).onConflictDoNothing({ target: advisoryLocks.agentId });
      const stored = await db.select({ lockKey: advisoryLocks.lockKey }).from(advisoryLocks).where(eq(advisoryLocks.agentId, agentId)).limit(1);
      const lockKey = stored[0]?.lockKey; if (lockKey === undefined) throw new Error("Agent lock key is unavailable");
      // PostgreSQL-native: a session advisory lock must be acquired on the
      // same dedicated connection that is retained for the Agent lifetime.
      const acquired = await client.query<{ acquired: boolean }>("SELECT pg_try_advisory_lock($1::bigint) AS acquired", [lockKey]);
      if (acquired.rows[0]?.acquired !== true) throw new DomainError("CONFLICT", `Agent is already running: ${agentId}`);
      return client;
    } catch (error) { client.release(); throw error; }
  }

  async release(client: PoolClient): Promise<void> {
    try {
      // PostgreSQL-native: releases session locks owned by this connection.
      await client.query("SELECT pg_advisory_unlock_all()");
    } finally { client.release(); }
  }
}
