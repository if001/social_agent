import { and, eq, inArray, isNull, notInArray, sql } from "drizzle-orm";

import { ConcernSchema, DomainError, type Concern } from "../../domain/contracts.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { concerns } from "./schema.js";

type ConcernClient = RuntimeDatabase["db"] | Parameters<Parameters<RuntimeDatabase["transaction"]>[0]>[0];

export class ConcernRepository {
  constructor(private readonly client: ConcernClient) {}

  async list(agentId: string, includeDeleted = false): Promise<readonly Concern[]> {
    const rows = await this.client.select().from(concerns).where(and(
      eq(concerns.agentId, agentId),
      includeDeleted ? undefined : isNull(concerns.deletedAt)
    )).orderBy(concerns.createdAt, concerns.id);
    return rows.map((row) => ConcernSchema.parse({
      id: row.id,
      description: row.description,
      whyItMatters: row.whyItMatters,
      status: row.status
    }));
  }

  /** Replaces the visible Concern set while retaining removed rows as audit history. */
  async replace(agentId: string, values: unknown, at = new Date()): Promise<readonly Concern[]> {
    const parsed = ConcernSchema.array().parse(values);
    const ids = parsed.map(({ id }) => id);
    if (ids.length > 0) {
      const owners = await this.client.select({ id: concerns.id, agentId: concerns.agentId }).from(concerns).where(inArray(concerns.id, ids));
      const foreign = owners.find((row) => row.agentId !== agentId);
      if (foreign !== undefined) throw new DomainError("CONFLICT", `Concern belongs to another Agent: ${foreign.id}`);
    }
    for (const concern of parsed) await this.client.insert(concerns).values({
      id: concern.id,
      agentId,
      description: concern.description,
      whyItMatters: concern.whyItMatters,
      status: concern.status,
      deletedAt: null,
      updatedAt: at
    }).onConflictDoUpdate({ target: concerns.id, set: {
      description: concern.description,
      whyItMatters: concern.whyItMatters,
      status: concern.status,
      version: sql`${concerns.version}+1`,
      deletedAt: null,
      updatedAt: at
    } });
    await this.client.update(concerns).set({ deletedAt: at, updatedAt: at, version: sql`${concerns.version}+1` }).where(and(
      eq(concerns.agentId, agentId),
      isNull(concerns.deletedAt),
      ids.length === 0 ? undefined : notInArray(concerns.id, ids)
    ));
    return parsed;
  }

  async markDeleted(agentId: string, ids: readonly string[], at = new Date()): Promise<void> {
    if (ids.length === 0) return;
    await this.client.update(concerns).set({ deletedAt: at, updatedAt: at, version: sql`${concerns.version}+1` }).where(and(
      eq(concerns.agentId, agentId), inArray(concerns.id, [...ids]), isNull(concerns.deletedAt)
    ));
  }
}
