import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import type { IdGenerator } from "./ports.js";
import { MemoryIntentSchema, type MemoryIntent } from "../domain/contracts.js";

type CandidateRow = QueryResultRow & { id: string; kind: string; content: string; importance: string; version: number; evidence_event_ids: string[] };
export type MemoryCandidate = { readonly id: string; readonly kind: string; readonly content: string; readonly importance: string };
export type MemoryWriteOptions = {
  readonly subjectIds?: readonly string[];
  readonly sourceEventId?: string;
  readonly intentIndex?: number;
  readonly sourceAgentId?: string;
  readonly candidates?: readonly MemoryCandidate[];
};
export type MemoryWriteOperation = "create" | "update" | "no-op";
export type MemoryWriteResult = { readonly operation: MemoryWriteOperation; readonly memoryId?: string; readonly version?: number };

const normalize = (value: string): string => value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ja");
const sameMemory = (left: string, right: string): boolean => {
  const a = normalize(left); const b = normalize(right);
  return a === b || (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a)));
};

export class MemoryWriteService {
  constructor(private readonly client: PoolClient, private readonly ids: IdGenerator, private readonly now: () => Date) {}

  async apply(agentId: string, rawIntent: MemoryIntent, options: MemoryWriteOptions = {}): Promise<MemoryWriteResult> {
    const intent = MemoryIntentSchema.parse(rawIntent);
    if (intent.evidenceEventIds.length === 0) throw new Error("MemoryIntent requires at least one evidence Event");
    const lock = await this.client.query<{ lock_key: string }>("SELECT lock_key::text AS lock_key FROM agent_lock_keys WHERE agent_id=$1", [agentId]);
    const lockKey = lock.rows[0]?.lock_key;
    if (lockKey === undefined) await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended($1,0))", [agentId]);
    else await this.client.query("SELECT pg_advisory_xact_lock($1::bigint)", [lockKey]);
    if (options.sourceEventId !== undefined && options.intentIndex !== undefined) {
      const prior = await this.client.query<{ operation: MemoryWriteOperation; memory_id: string | null }>("SELECT operation,memory_id FROM memory_mutations WHERE agent_id=$1 AND source_event_id=$2 AND intent_index=$3", [agentId, options.sourceEventId, options.intentIndex]);
      const existing = prior.rows[0];
      if (existing !== undefined) return { operation: existing.operation, ...(existing.memory_id === null ? {} : { memoryId: existing.memory_id }) };
    }
    const candidates: readonly CandidateRow[] = options.candidates === undefined
      ? (await this.client.query<CandidateRow>("SELECT id,kind,content,importance,version,evidence_event_ids FROM memories WHERE agent_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 20", [agentId])).rows
      : options.candidates.map((candidate) => ({ ...candidate, version: 0, evidence_event_ids: [] as string[] }));
    const candidate = candidates.find((row) => row.kind === intent.target && sameMemory(row.content, intent.content));
    if (candidate !== undefined) {
      const evidence = [...new Set([...candidate.evidence_event_ids, ...intent.evidenceEventIds])];
      const updated = await this.client.query<{ version: number }>(
        "UPDATE memories SET content=$3,importance=$4,evidence_event_ids=$5,version=version+1,embedding=NULL,embedding_model=NULL,embedding_dimension=NULL,embedding_status='pending',embedding_error=NULL,source_agent_id=COALESCE(source_agent_id,$7),updated_at=now() WHERE id=$1 AND agent_id=$2 AND version=$6 RETURNING version",
        [candidate.id, agentId, intent.content, intent.reason, JSON.stringify(evidence), candidate.version, options.sourceAgentId ?? null]
      );
      if (updated.rowCount === 1) {
        const version = updated.rows[0]?.version;
        for (const subjectId of options.subjectIds ?? []) await this.client.query("INSERT INTO memory_subjects(memory_id,subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [candidate.id, subjectId]);
        await this.#record(agentId, candidate.id, "update", candidate.id, intent, options, version);
        return { operation: "update", memoryId: candidate.id, ...(version === undefined ? {} : { version }) };
      }
      await this.#record(agentId, candidate.id, "no-op", candidate.id, intent, options);
      return { operation: "no-op", memoryId: candidate.id };
    }
    if (intent.confidence === "low") {
      await this.#record(agentId, undefined, "no-op", undefined, intent, options);
      return { operation: "no-op" };
    }
    const id = this.ids.next();
    const occurredAt = this.now().toISOString();
    await this.client.query(
      "INSERT INTO memories(id,agent_id,kind,content,importance,retrieval_priority,occurred_at,created_at,evidence_event_ids,source_agent_id,version,embedding_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,'pending')",
      [id, agentId, intent.target, intent.content, intent.reason, intent.confidence === "high" ? "high" : "normal", occurredAt, occurredAt, JSON.stringify(intent.evidenceEventIds), options.sourceAgentId ?? null]
    );
    for (const subjectId of options.subjectIds ?? []) await this.client.query("INSERT INTO memory_subjects(memory_id,subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, subjectId]);
    await this.#record(agentId, id, "create", undefined, intent, options, 0);
    return { operation: "create", memoryId: id, version: 0 };
  }

  async #record(agentId: string, memoryId: string | undefined, operation: MemoryWriteOperation, candidateMemoryId: string | undefined, intent: MemoryIntent, options: MemoryWriteOptions, version?: number): Promise<void> {
    await this.client.query(
      "INSERT INTO memory_mutations(id,agent_id,memory_id,operation,candidate_memory_id,source_event_id,intent_index,source_agent_id,intent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING",
      [randomUUID(), agentId, memoryId ?? null, operation, candidateMemoryId ?? null, options.sourceEventId ?? null, options.intentIndex ?? null, options.sourceAgentId ?? null, JSON.stringify({ ...intent, ...(version === undefined ? {} : { version }) })]
    );
  }
}
