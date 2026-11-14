import type { Pool } from "pg";
import { and, eq, sql } from "drizzle-orm";
import { createRuntimeDatabase } from "../infrastructure/persistence/runtime-database.js";
import { memories } from "../infrastructure/persistence/schema.js";

export type MemoryEvidenceNormalizationOptions = {
  readonly agentId?: string;
  readonly apply: boolean;
};

export type MemoryEvidenceNormalizationResult = {
  readonly scanned: number;
  readonly normalized: number;
};

/** Clears invalid, over-limit provenance links without changing Memory content. */
export async function normalizeOverfullMemoryEvidence(pool: Pool, options: MemoryEvidenceNormalizationOptions): Promise<MemoryEvidenceNormalizationResult> {
  const database = createRuntimeDatabase(pool);
  const candidates = await database.db.select({ id: memories.id, agentId: memories.agentId }).from(memories).where(and(
    sql`jsonb_array_length(${memories.evidenceEventIds}) > 16`,
    options.agentId === undefined ? undefined : eq(memories.agentId, options.agentId)
  )).orderBy(memories.agentId, memories.id);
  if (!options.apply || candidates.length === 0) return { scanned: candidates.length, normalized: 0 };
  const normalized = await database.transaction(async (tx) => {
    let count = 0;
    for (const candidate of candidates) count += (await tx.update(memories).set({ evidenceEventIds: [] }).where(and(eq(memories.id, candidate.id), eq(memories.agentId, candidate.agentId), sql`jsonb_array_length(${memories.evidenceEventIds}) > 16`)).returning({ id: memories.id })).length;
    return count;
  });
  return { scanned: candidates.length, normalized };
}
