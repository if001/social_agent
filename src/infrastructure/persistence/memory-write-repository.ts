import { randomUUID } from "node:crypto";
import type { IdGenerator, MemoryEmbedding } from "../../application/ports.js";
import { MemoryIntentSchema, type MemoryIntent } from "../../domain/contracts.js";
import type { Pool, PoolClient } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import type { RuntimeDatabase } from "./runtime-database.js";
import { createRuntimeDatabase } from "./runtime-database.js";
import * as schema from "./schema.js";
import { memories, memoryMutations, memorySubjects } from "./schema.js";

type CandidateRow = { id: string; kind: string; content: string; importance: string; version: number; evidence_event_ids: string[]; perspective?: string; purpose?: string };
export type MemoryWriteTransaction = Pick<RuntimeDatabase["db"], "select" | "insert" | "update" | "execute">;
export type MemoryCandidate = { readonly id: string; readonly kind: string; readonly content: string; readonly importance: string };
export type MemoryWriteOptions = { readonly subjectIds?: readonly string[]; readonly sourceEventId?: string; readonly sourceRunId?: string; readonly sourceKind?: "agent-run" | "experience-integration" | "memory-update" | "reflection-formation" | "reflection-reconciliation"; readonly sourceId?: string; readonly intentIndex?: number; readonly sourceAgentId?: string; readonly candidates?: readonly MemoryCandidate[]; readonly evidenceMemoryIds?: readonly string[]; readonly embedding?: MemoryEmbedding; };
export type MemoryWriteOperation = "create" | "update" | "no-op";
export type MemoryWriteResult = { readonly operation: MemoryWriteOperation; readonly memoryId?: string; readonly version?: number };
export type MemoryReconciliationWrite = { readonly memoryId: string; readonly operation: "keep" | "update" | "split"; readonly content?: string | undefined; readonly reason: string; readonly evidenceEventIds: readonly string[]; readonly split?: readonly { readonly content: string; readonly reason: string }[] | undefined; };

export async function recordMemoryMutationFailure(pool: Pool, agentId: string, intent: unknown, options: Pick<MemoryWriteOptions, "sourceEventId" | "sourceRunId" | "sourceKind" | "sourceId" | "intentIndex">, error: unknown, now: Date): Promise<void> {
  const sourceKind = options.sourceKind ?? (options.sourceEventId === undefined ? undefined : "memory-update");
  const sourceId = options.sourceId ?? options.sourceEventId;
  if (sourceKind === undefined || sourceId === undefined || options.intentIndex === undefined) return;
  const intentIndex = options.intentIndex;
  const reason = error instanceof Error ? error.message : String(error);
  await createRuntimeDatabase(pool).transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('memory-write:' || ${agentId},0))`);
    const attempt = (await tx.select({ value: sql<number>`coalesce(max(${memoryMutations.attempt}),0)+1` }).from(memoryMutations).where(and(eq(memoryMutations.agentId, agentId), eq(memoryMutations.sourceKind, sourceKind), eq(memoryMutations.sourceId, sourceId), eq(memoryMutations.intentIndex, intentIndex))))[0]?.value ?? 1;
    await tx.insert(memoryMutations).values({ id: randomUUID(), agentId, operation: "unknown", sourceEventId: options.sourceEventId ?? null, sourceRunId: options.sourceRunId ?? null, sourceKind, sourceId, intentIndex, attempt, intent, status: "failed", failureReason: reason, idempotencyKey: `${agentId}:${sourceKind}:${sourceId}:${String(intentIndex)}`, createdAt: now });
  });
}

const normalize = (value: string): string => value.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ja");
export const mergeMemoryEvidence = (existing: readonly string[], incoming: readonly string[]) => [...new Set([...incoming, ...existing])].slice(0, 16);
const sameMemory = (left: string, right: string): boolean => { const a = normalize(left); const b = normalize(right); return a === b || (a.length >= 8 && b.length >= 8 && (a.includes(b) || b.includes(a))); };

/** Infrastructure repository used inside an already-open PostgreSQL transaction. */
export class MemoryWriteService {
  private readonly client: MemoryWriteTransaction;
  constructor(client: MemoryWriteTransaction | PoolClient, private readonly ids: IdGenerator, private readonly now: () => Date) {
    this.client = "execute" in client ? client : drizzle(client, { schema });
  }

  async apply(agentId: string, rawIntent: MemoryIntent, options: MemoryWriteOptions = {}): Promise<MemoryWriteResult> {
    const intent = MemoryIntentSchema.parse(rawIntent);
    if (intent.evidenceEventIds.length === 0) throw new Error("MemoryIntent requires at least one evidence Event");
    // PostgreSQL-native: serialize Memory mutation attempts for one Agent.
    await this.client.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('memory-write:' || ${agentId}, 0))`);
    const sourceKind = options.sourceKind ?? (options.sourceEventId === undefined ? undefined : "memory-update");
    const sourceId = options.sourceId ?? options.sourceEventId;
    if (sourceKind !== undefined && sourceId !== undefined && options.intentIndex !== undefined) {
      const existing = (await this.client.select({ operation: memoryMutations.operation, memoryId: memoryMutations.memoryId }).from(memoryMutations).where(and(eq(memoryMutations.agentId, agentId), eq(memoryMutations.sourceKind, sourceKind), eq(memoryMutations.sourceId, sourceId), eq(memoryMutations.intentIndex, options.intentIndex), inArray(memoryMutations.status, ["applied", "no-op"]))).orderBy(desc(memoryMutations.attempt)).limit(1))[0];
      if (existing !== undefined) return { operation: existing.operation as MemoryWriteOperation, ...(existing.memoryId === null ? {} : { memoryId: existing.memoryId }) };
    } else if (options.sourceEventId !== undefined && options.intentIndex !== undefined) {
      const existing = (await this.client.select({ operation: memoryMutations.operation, memoryId: memoryMutations.memoryId }).from(memoryMutations).where(and(eq(memoryMutations.agentId, agentId), eq(memoryMutations.sourceEventId, options.sourceEventId), eq(memoryMutations.intentIndex, options.intentIndex), inArray(memoryMutations.status, ["applied", "no-op"]))).orderBy(desc(memoryMutations.attempt)).limit(1))[0];
      if (existing !== undefined) return { operation: existing.operation as MemoryWriteOperation, ...(existing.memoryId === null ? {} : { memoryId: existing.memoryId }) };
    }
    const candidates: readonly CandidateRow[] = options.candidates === undefined ? (await this.client.select().from(memories).where(eq(memories.agentId, agentId)).orderBy(desc(memories.occurredAt), desc(memories.id)).limit(20)).map((row) => ({ id: row.id, kind: row.kind, content: row.content, importance: row.importance, version: row.version, evidence_event_ids: row.evidenceEventIds as string[], perspective: row.perspective, purpose: row.purpose })) : options.candidates.map((candidate) => ({ ...candidate, version: 0, evidence_event_ids: [] as string[] }));
    const candidate = candidates.find((row) => row.kind === intent.target && sameMemory(row.content, intent.content));
    const embedding = options.embedding ?? { status: "pending" as const };
    const vector = embedding.vector === undefined ? null : [...embedding.vector];
    if (candidate !== undefined) {
      const evidence = mergeMemoryEvidence(candidate.evidence_event_ids, intent.evidenceEventIds);
      const before = auditSnapshot(candidate);
      const updated = await this.client.update(memories).set({ content: intent.content, importance: intent.reason, evidenceEventIds: evidence, version: sql`${memories.version}+1`, embedding: vector, embeddingModel: embedding.model ?? null, embeddingDimension: embedding.dimension ?? null, embeddingStatus: embedding.status, embeddingError: embedding.error ?? null, sourceAgentId: sql`coalesce(${memories.sourceAgentId},${options.sourceAgentId ?? null})`, perspective: intent.perspective, purpose: intent.purpose, updatedAt: new Date() }).where(and(eq(memories.id, candidate.id), eq(memories.agentId, agentId), eq(memories.version, candidate.version))).returning({ version: memories.version });
      if (updated.length === 1) {
        const version = updated[0]?.version;
        if ((options.subjectIds?.length ?? 0) > 0) await this.client.insert(memorySubjects).values((options.subjectIds ?? []).map((subjectId) => ({ memoryId: candidate.id, subjectId }))).onConflictDoNothing();
        await this.#record(agentId, candidate.id, "update", candidate.id, intent, options, before, auditSnapshot({ ...candidate, content: intent.content, importance: intent.reason, perspective: intent.perspective, purpose: intent.purpose, version: version ?? candidate.version + 1 }));
        return { operation: "update", memoryId: candidate.id, ...(version === undefined ? {} : { version }) };
      }
      await this.#record(agentId, candidate.id, "no-op", candidate.id, intent, options, before, before);
      return { operation: "no-op", memoryId: candidate.id };
    }
    if (intent.confidence === "low") { await this.#record(agentId, undefined, "no-op", undefined, intent, options, null, null); return { operation: "no-op" }; }
    const id = this.ids.next(); const occurredAt = this.now().toISOString();
    await this.client.insert(memories).values({ id, agentId, kind: intent.target, content: intent.content, importance: intent.reason, retrievalPriority: intent.confidence === "high" ? "high" : "normal", occurredAt: new Date(occurredAt), createdAt: new Date(occurredAt), evidenceEventIds: intent.evidenceEventIds, sourceAgentId: options.sourceAgentId ?? null, version: 0, embedding: vector, embeddingModel: embedding.model ?? null, embeddingDimension: embedding.dimension ?? null, embeddingStatus: embedding.status, embeddingError: embedding.error ?? null, perspective: intent.perspective, purpose: intent.purpose });
    if ((options.subjectIds?.length ?? 0) > 0) await this.client.insert(memorySubjects).values((options.subjectIds ?? []).map((subjectId) => ({ memoryId: id, subjectId }))).onConflictDoNothing();
    await this.#record(agentId, id, "create", undefined, intent, options, null, { content: intent.content, importance: intent.reason, perspective: intent.perspective, purpose: intent.purpose, version: 0 });
    return { operation: "create", memoryId: id, version: 0 };
  }

  async reconcile(agentId: string, change: MemoryReconciliationWrite, options: Pick<MemoryWriteOptions, "sourceEventId" | "sourceRunId" | "sourceKind" | "sourceId" | "intentIndex">): Promise<void> {
    await this.client.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended('memory-write:' || ${agentId}, 0))`);
    const sourceKind = options.sourceKind ?? (options.sourceEventId === undefined ? undefined : "memory-update");
    const sourceId = options.sourceId ?? options.sourceEventId;
    if (sourceKind !== undefined && sourceId !== undefined && options.intentIndex !== undefined) {
      const existing = await this.client.select({ id: memoryMutations.id }).from(memoryMutations).where(and(eq(memoryMutations.agentId, agentId), eq(memoryMutations.sourceKind, sourceKind), eq(memoryMutations.sourceId, sourceId), eq(memoryMutations.intentIndex, options.intentIndex), inArray(memoryMutations.status, ["applied", "no-op"]))).limit(1);
      if (existing[0] !== undefined) return;
    }
    const base = (await this.client.select().from(memories).where(and(eq(memories.agentId, agentId), eq(memories.id, change.memoryId))).limit(1))[0];
    const subjects = base === undefined ? [] : (await this.client.select({ subjectId: memorySubjects.subjectId }).from(memorySubjects).where(eq(memorySubjects.memoryId, base.id))).map(({ subjectId }) => subjectId);
    const row = base === undefined ? undefined : { id: base.id, kind: base.kind, content: base.content, importance: base.importance, perspective: base.perspective, purpose: base.purpose, version: base.version, evidence_event_ids: base.evidenceEventIds as string[], subjects };
    if (row === undefined) throw new Error("Memory reconciliation target was not found");
    const before = auditSnapshot(row);
    if (change.operation === "keep") { await this.#record(agentId, row.id, "no-op", row.id, { content: "Reconciliation keep", reason: change.reason, evidenceEventIds: [], confidence: "low", target: "semantic", perspective: "self", purpose: "self-guidance" }, options, before, before); return; }
    if (row.kind === "episodic") throw new Error("Episodic Memory cannot be reconciled");
    if (change.evidenceEventIds.length === 0) throw new Error("Memory reconciliation requires Event evidence");
    if (change.operation === "update") {
      if (change.content === undefined) throw new Error("Memory reconciliation update requires content");
      await this.client.update(memories).set({ content: change.content, importance: change.reason, evidenceEventIds: mergeMemoryEvidence(row.evidence_event_ids, change.evidenceEventIds), embedding: null, embeddingStatus: "pending", version: sql`${memories.version}+1`, updatedAt: new Date() }).where(and(eq(memories.agentId, agentId), eq(memories.id, row.id)));
      await this.#record(agentId, row.id, "update", row.id, { content: change.content, reason: change.reason, evidenceEventIds: [...change.evidenceEventIds], confidence: "medium", target: row.kind as MemoryIntent["target"], perspective: "self", purpose: "self-guidance" }, options, before, { ...before, content: change.content, importance: change.reason, version: row.version + 1 }); return;
    }
    if (change.split === undefined || change.split.length !== 2) throw new Error("Memory reconciliation split requires two parts");
    const [retained, derived] = change.split;
    if (retained === undefined || derived === undefined) throw new Error("Memory reconciliation split requires two parts");
    await this.client.update(memories).set({ content: retained.content, importance: retained.reason, evidenceEventIds: mergeMemoryEvidence(row.evidence_event_ids, change.evidenceEventIds), embedding: null, embeddingStatus: "pending", version: sql`${memories.version}+1`, updatedAt: new Date() }).where(and(eq(memories.agentId, agentId), eq(memories.id, row.id)));
    await this.#record(agentId, row.id, "update", row.id, { content: retained.content, reason: retained.reason, evidenceEventIds: [...change.evidenceEventIds], confidence: "medium", target: row.kind as MemoryIntent["target"], perspective: "self", purpose: "self-guidance" }, options, before, { ...before, content: retained.content, importance: retained.reason, version: row.version + 1 });
    const result = await this.apply(agentId, { content: derived.content, reason: derived.reason, evidenceEventIds: [...change.evidenceEventIds], confidence: "medium", target: row.kind as MemoryIntent["target"], perspective: "self", purpose: "self-guidance" }, { ...options, intentIndex: -((options.intentIndex ?? 0) + 1), subjectIds: [...row.subjects], candidates: [] });
    if (result.memoryId !== undefined) await this.client.update(memories).set({ evidenceMemoryIds: [row.id], updatedAt: new Date() }).where(and(eq(memories.agentId, agentId), eq(memories.id, result.memoryId)));
  }

  async #record(agentId: string, memoryId: string | undefined, operation: MemoryWriteOperation, candidateMemoryId: string | undefined, intent: MemoryIntent, options: MemoryWriteOptions, before: unknown, after: unknown): Promise<void> {
    const sourceKind = options.sourceKind ?? (options.sourceEventId === undefined ? undefined : "memory-update");
    const sourceId = options.sourceId ?? options.sourceEventId;
    const idempotencyKey = sourceKind === undefined || sourceId === undefined || options.intentIndex === undefined ? undefined : `${agentId}:${sourceKind}:${sourceId}:${String(options.intentIndex)}`;
    const candidateMemoryIds = [...new Set([...(options.candidates?.map(({ id }) => id) ?? []), ...(candidateMemoryId === undefined ? [] : [candidateMemoryId])])];
    const attemptRow = sourceKind === undefined || sourceId === undefined || options.intentIndex === undefined ? undefined : (await this.client.select({ attempt: sql<number>`coalesce(max(${memoryMutations.attempt}),0)+1` }).from(memoryMutations).where(and(eq(memoryMutations.agentId, agentId), eq(memoryMutations.sourceKind, sourceKind), eq(memoryMutations.sourceId, sourceId), eq(memoryMutations.intentIndex, options.intentIndex))))[0];
    const attempt = attemptRow?.attempt ?? 1;
    await this.client.insert(memoryMutations).values({ id: randomUUID(), agentId, memoryId: memoryId ?? null, operation, candidateMemoryId: candidateMemoryId ?? null, candidateMemoryIds, sourceEventId: options.sourceEventId ?? null, sourceRunId: options.sourceRunId ?? null, sourceKind: sourceKind ?? null, sourceId: sourceId ?? null, intentIndex: options.intentIndex ?? null, attempt, sourceAgentId: options.sourceAgentId ?? null, intent, before, after, reason: intent.reason, evidenceEventIds: intent.evidenceEventIds, evidenceMemoryIds: options.evidenceMemoryIds ?? [], status: operation === "no-op" ? "no-op" : "applied", idempotencyKey: idempotencyKey ?? null, appliedAt: this.now() });
  }
}

const auditSnapshot = (memory: Pick<CandidateRow, "content" | "importance" | "version"> & Partial<Pick<CandidateRow, "perspective" | "purpose">>) => ({ content: memory.content, importance: memory.importance, perspective: memory.perspective ?? "self", purpose: memory.purpose ?? "self-guidance", version: memory.version });
