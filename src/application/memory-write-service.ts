import { randomUUID } from "node:crypto";
import type { PoolClient, QueryResultRow } from "pg";

import type { IdGenerator, MemoryEmbedding } from "./ports.js";
import { MemoryIntentSchema, type MemoryIntent } from "../domain/contracts.js";

type CandidateRow = QueryResultRow & { id: string; kind: string; content: string; importance: string; version: number; evidence_event_ids: string[] };
export type MemoryCandidate = { readonly id: string; readonly kind: string; readonly content: string; readonly importance: string };
export type MemoryWriteOptions = {
  readonly subjectIds?: readonly string[];
  readonly sourceEventId?: string;
  readonly intentIndex?: number;
  readonly sourceAgentId?: string;
  readonly candidates?: readonly MemoryCandidate[];
  readonly embedding?: MemoryEmbedding;
};
export type MemoryWriteOperation = "create" | "update" | "no-op";
export type MemoryWriteResult = { readonly operation: MemoryWriteOperation; readonly memoryId?: string; readonly version?: number };
export type MemoryReconciliationWrite = { readonly memoryId: string; readonly operation: "keep" | "update" | "split"; readonly content?: string | undefined; readonly reason: string; readonly evidenceEventIds: readonly string[]; readonly split?: readonly { readonly content: string; readonly reason: string }[] | undefined; };

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
    // Use a namespace separate from bot-host's session-level Agent lock.
    // bot-host intentionally holds one process lock for its lifetime; using the
    // same key here would make every Memory write wait on its own process.
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended('memory-write:' || $1, 0))", [agentId]);
    if (options.sourceEventId !== undefined && options.intentIndex !== undefined) {
      const prior = await this.client.query<{ operation: MemoryWriteOperation; memory_id: string | null }>("SELECT operation,memory_id FROM memory_mutations WHERE agent_id=$1 AND source_event_id=$2 AND intent_index=$3", [agentId, options.sourceEventId, options.intentIndex]);
      const existing = prior.rows[0];
      if (existing !== undefined) return { operation: existing.operation, ...(existing.memory_id === null ? {} : { memoryId: existing.memory_id }) };
    }
    const candidates: readonly CandidateRow[] = options.candidates === undefined
      ? (await this.client.query<CandidateRow>("SELECT id,kind,content,importance,version,evidence_event_ids FROM memories WHERE agent_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 20", [agentId])).rows
      : options.candidates.map((candidate) => ({ ...candidate, version: 0, evidence_event_ids: [] as string[] }));
    const candidate = candidates.find((row) => row.kind === intent.target && sameMemory(row.content, intent.content));
    const embedding = options.embedding ?? { status: "pending" as const };
    const vector = embedding.vector === undefined ? null : `[${embedding.vector.join(",")}]`;
    if (candidate !== undefined) {
      const evidence = [...new Set([...candidate.evidence_event_ids, ...intent.evidenceEventIds])];
      const updated = await this.client.query<{ version: number }>(
        "UPDATE memories SET content=$3,importance=$4,evidence_event_ids=$5,version=version+1,embedding=$7::vector,embedding_model=$8,embedding_dimension=$9,embedding_status=$10,embedding_error=$11,source_agent_id=COALESCE(source_agent_id,$12),perspective=$13,purpose=$14,updated_at=now() WHERE id=$1 AND agent_id=$2 AND version=$6 RETURNING version",
        [candidate.id, agentId, intent.content, intent.reason, JSON.stringify(evidence), candidate.version, vector, embedding.model ?? null, embedding.dimension ?? null, embedding.status, embedding.error ?? null, options.sourceAgentId ?? null, intent.perspective, intent.purpose]
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
      "INSERT INTO memories(id,agent_id,kind,content,importance,retrieval_priority,occurred_at,created_at,evidence_event_ids,source_agent_id,version,embedding,embedding_model,embedding_dimension,embedding_status,embedding_error,perspective,purpose) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,0,$11::vector,$12,$13,$14,$15,$16,$17)",
      [id, agentId, intent.target, intent.content, intent.reason, intent.confidence === "high" ? "high" : "normal", occurredAt, occurredAt, JSON.stringify(intent.evidenceEventIds), options.sourceAgentId ?? null, vector, embedding.model ?? null, embedding.dimension ?? null, embedding.status, embedding.error ?? null, intent.perspective, intent.purpose]
    );
    for (const subjectId of options.subjectIds ?? []) await this.client.query("INSERT INTO memory_subjects(memory_id,subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [id, subjectId]);
    await this.#record(agentId, id, "create", undefined, intent, options, 0);
    return { operation: "create", memoryId: id, version: 0 };
  }

  /** The only write path for an existing Memory's Reflection maintenance. */
  async reconcile(agentId: string, change: MemoryReconciliationWrite, options: Pick<MemoryWriteOptions, "sourceEventId" | "intentIndex">): Promise<void> {
    await this.client.query("SELECT pg_advisory_xact_lock(hashtextextended('memory-write:' || $1, 0))", [agentId]);
    const row = (await this.client.query<{ id: string; kind: string; evidence_event_ids: string[]; subjects: readonly string[] }>(`SELECT m.id,m.kind,m.evidence_event_ids,COALESCE(array_agg(ms.subject_id) FILTER (WHERE ms.subject_id IS NOT NULL),'{}') AS subjects
      FROM memories m LEFT JOIN memory_subjects ms ON ms.memory_id=m.id WHERE m.agent_id=$1 AND m.id=$2 GROUP BY m.id`, [agentId, change.memoryId])).rows[0];
    if (row === undefined) throw new Error("Memory reconciliation target was not found");
    if (change.operation === "keep") { await this.#record(agentId, row.id, "no-op", row.id, { content: "Reconciliation keep", reason: change.reason, evidenceEventIds: [], confidence: "low", target: "semantic", perspective: "self", purpose: "self-guidance" }, options); return; }
    if (row.kind === "episodic") throw new Error("Episodic Memory cannot be reconciled");
    if (change.evidenceEventIds.length === 0) throw new Error("Memory reconciliation requires Event evidence");
    if (change.operation === "update") {
      if (change.content === undefined) throw new Error("Memory reconciliation update requires content");
      await this.client.query("UPDATE memories SET content=$3,importance=$4,evidence_event_ids=$5,embedding=NULL,embedding_status='pending',version=version+1,updated_at=now() WHERE agent_id=$1 AND id=$2", [agentId, row.id, change.content, change.reason, JSON.stringify([...new Set([...row.evidence_event_ids, ...change.evidenceEventIds])])]);
      await this.#record(agentId, row.id, "update", row.id, { content: change.content, reason: change.reason, evidenceEventIds: [...change.evidenceEventIds], confidence: "medium", target: row.kind as MemoryIntent["target"], perspective: "self", purpose: "self-guidance" }, options);
      return;
    }
    if (change.split === undefined || change.split.length !== 2) throw new Error("Memory reconciliation split requires two parts");
    const [retained, derived] = change.split;
    if (retained === undefined || derived === undefined) throw new Error("Memory reconciliation split requires two parts");
    // Split is one atomic composite: narrow the original, then create the
    // derived part while retaining an explicit link back to that original.
    await this.client.query("UPDATE memories SET content=$3,importance=$4,evidence_event_ids=$5,embedding=NULL,embedding_status='pending',version=version+1,updated_at=now() WHERE agent_id=$1 AND id=$2", [agentId, row.id, retained.content, retained.reason, JSON.stringify([...new Set([...row.evidence_event_ids, ...change.evidenceEventIds])])]);
    await this.#record(agentId, row.id, "update", row.id, { content: retained.content, reason: retained.reason, evidenceEventIds: [...change.evidenceEventIds], confidence: "medium", target: row.kind as MemoryIntent["target"], perspective: "self", purpose: "self-guidance" }, options);
    const result = await this.apply(agentId, { content: derived.content, reason: derived.reason, evidenceEventIds: [...change.evidenceEventIds], confidence: "medium", target: row.kind as MemoryIntent["target"], perspective: "self", purpose: "self-guidance" }, { ...(options.sourceEventId === undefined ? {} : { sourceEventId: options.sourceEventId }), intentIndex: (options.intentIndex ?? 0) * 10 + 1, subjectIds: [...row.subjects], candidates: [] });
    if (result.memoryId !== undefined) await this.client.query("UPDATE memories SET evidence_memory_ids=$3,updated_at=now() WHERE agent_id=$1 AND id=$2", [agentId, result.memoryId, JSON.stringify([row.id])]);
  }

  async #record(agentId: string, memoryId: string | undefined, operation: MemoryWriteOperation, candidateMemoryId: string | undefined, intent: MemoryIntent, options: MemoryWriteOptions, version?: number): Promise<void> {
    await this.client.query(
      "INSERT INTO memory_mutations(id,agent_id,memory_id,operation,candidate_memory_id,source_event_id,intent_index,source_agent_id,intent) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) ON CONFLICT DO NOTHING",
      [randomUUID(), agentId, memoryId ?? null, operation, candidateMemoryId ?? null, options.sourceEventId ?? null, options.intentIndex ?? null, options.sourceAgentId ?? null, JSON.stringify({ ...intent, ...(version === undefined ? {} : { version }) })]
    );
  }
}
