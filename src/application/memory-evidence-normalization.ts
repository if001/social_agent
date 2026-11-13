import type { Pool } from "pg";

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
  const candidates = await pool.query<{ id: string; agent_id: string }>(
    "SELECT id,agent_id FROM memories WHERE jsonb_array_length(evidence_event_ids)>16 AND ($1::text IS NULL OR agent_id=$1) ORDER BY agent_id,id",
    [options.agentId ?? null]
  );
  if (!options.apply || candidates.rows.length === 0) return { scanned: candidates.rows.length, normalized: 0 };
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    let normalized = 0;
    for (const candidate of candidates.rows) {
      const result = await client.query("UPDATE memories SET evidence_event_ids='[]'::jsonb WHERE id=$1 AND agent_id=$2 AND jsonb_array_length(evidence_event_ids)>16", [candidate.id, candidate.agent_id]);
      normalized += result.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return { scanned: candidates.rows.length, normalized };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
