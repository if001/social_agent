import { createHash } from "node:crypto";
import { z } from "zod";

import { EventExperienceSchema, memorySubjectsForIntegration, type ExperienceIntegrationInput, type ExperienceIntegrationOutput, type ExperienceIntegrationRepository } from "../../application/experience-integration.js";
import type { CanonicalSubjectResolver } from "../../application/canonical-subject.js";
import type { IdGenerator, MemoryEmbeddingPreparer } from "../../application/ports.js";
import { MemoryWriteService, recordMemoryMutationFailure, type MemoryWriteOptions } from "./memory-write-repository.js";
import { errorLogContext } from "../../observability/logger.js";
import { AgentStateRepository } from "./postgres.js";
import { AgentCoreInputSchema, AgentRunResultSchema, type DomainEvent, type MemoryIntent } from "../../domain/contracts.js";
import { and, asc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import type { RuntimeDatabase } from "./runtime-database.js";
import { agentRuns, eventExperiences, eventProjections, eventSubjects, events, experienceIntegrations, stateChanges } from "./schema.js";

type PendingIntegrationRow = { id: string; agent_id: string; source_event_id: string; source_run_id: string; kind: DomainEvent["kind"]; occurred_at: Date; observation: Record<string, unknown>; input_snapshot: unknown; result: Record<string, unknown> };
const LegacyPeerActionSchema = z.object({
  type: z.literal("respond"),
  content: z.string().trim().min(1).max(6_000).optional(),
  peer: z.object({ name: z.string().trim().min(1).max(120), content: z.string().trim().min(1).max(6_000) }).strict()
}).strict();
const experienceContent = (experience: { readonly summary: string; readonly facts: readonly string[] }) => `${experience.summary}\n${experience.facts.join("\n")}`;
const experienceHash = (experience: { readonly summary: string; readonly facts: readonly string[] }) => createHash("sha256").update(experienceContent(experience)).digest("hex");
const sourceActor = (event: DomainEvent): { readonly id: string; readonly type: "human" | "agent" | "tool" | "system" | "unknown" } | undefined => {
  const actorId = typeof event.payload.actorId === "string" ? event.payload.actorId : typeof event.payload.senderAgentId === "string" ? event.payload.senderAgentId : undefined;
  const type = event.payload.actorType;
  const actorType: "human" | "agent" | "tool" | "system" | "unknown" = type === "human" || type === "agent" || type === "tool" || type === "system" ? type : "unknown";
  return actorId === undefined ? undefined : { id: actorId, type: actorType };
};

function normalizeLegacyRecentActions(value: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(value.recentExperiences)) return value;
  return { ...value, recentExperiences: (value.recentExperiences as unknown[]).map((experience: unknown): unknown => {
    if (typeof experience !== "object" || experience === null) return experience;
    const record = experience as Record<string, unknown>;
    if (!Array.isArray(record.steps)) return experience;
    return { ...record, steps: (record.steps as unknown[]).map((step: unknown): unknown => {
      if (typeof step !== "object" || step === null) return step;
      const stepRecord = step as Record<string, unknown>;
      const action = stepRecord.action;
      if (stepRecord.type !== "action" || typeof action !== "object" || action === null) return step;
      const actionRecord = action as Record<string, unknown>;
      if (actionRecord.type !== "respond" || !("peer" in actionRecord)) return step;
      const legacy = LegacyPeerActionSchema.safeParse(actionRecord);
      if (!legacy.success) return step;
      const content = legacy.data.content ?? legacy.data.peer.content;
      return { ...stepRecord, action: { type: "respond", content } };
    }) };
  }) };
}

/** Removes known legacy fields before strictly restoring the canonical Core input. */
export function parseDecisionInput(value: unknown) {
  if (typeof value !== "object" || value === null) return AgentCoreInputSchema.parse(value);
  const coreInput = { ...(value as Record<string, unknown>) };
  delete coreInput.persistentState;
  return AgentCoreInputSchema.parse(normalizeLegacyRecentActions(coreInput));
}

export class PostgresExperienceIntegrationRepository implements ExperienceIntegrationRepository {
  constructor(private readonly database: RuntimeDatabase, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly embedding?: MemoryEmbeddingPreparer, private readonly subjects?: CanonicalSubjectResolver) {}
  async begin(input: ExperienceIntegrationInput): Promise<"created" | "duplicate"> {
    const result = await this.database.db.insert(experienceIntegrations).values({ id: input.integrationId, sourceRunId: input.sourceRunId, status: "pending" }).onConflictDoNothing({ target: experienceIntegrations.sourceRunId }).returning({ id: experienceIntegrations.id });
    return result.length === 1 ? "created" : "duplicate";
  }
  async apply(input: ExperienceIntegrationInput, output: ExperienceIntegrationOutput): Promise<void> {
    const embedding = this.embedding;
    const embeddings = embedding === undefined ? [] : await Promise.all(output.memories.map(({ content }) => embedding.prepareMemory(content)));
    const experienceEmbedding = embedding === undefined ? undefined : await embedding.prepareMemory(experienceContent(output.experience));
    let failedIntent: MemoryIntent | undefined; let failedOptions: MemoryWriteOptions | undefined;
    try { await this.database.transaction(async (client) => {
      const stateRepository = new AgentStateRepository(client);
      const row = await stateRepository.find<{ version: number; mood: string; relationships: unknown }>(input.agentId);
      if (row === undefined) throw new Error("Agent state is unavailable for Experience Integration");
      const relationships = Array.isArray(row.relationships) ? row.relationships as { subjectId: string; description: string }[] : [];
      let nextRelationships = relationships; let nextMood = row.mood;
      const changes: { target: string; operation: string; before: unknown; after: unknown }[] = [];
      if (output.mood !== undefined && output.mood !== row.mood) { nextMood = output.mood; changes.push({ target: "mood", operation: "set", before: row.mood, after: nextMood }); }
      const actor = sourceActor(input.sourceEvent);
      const subjectId = this.subjects?.resolve(actor);
      if (output.relationship !== undefined && subjectId !== undefined) {
        const before = relationships;
        const relationship = output.relationship;
        const current = relationships.find((value) => value.subjectId === subjectId);
        if (relationship.operation === "remove") {
          if (current !== undefined && relationship.currentDescription === current.description) {
            nextRelationships = relationships.filter((value) => value.subjectId !== subjectId);
            changes.push({ target: "relationships", operation: relationship.operation, before, after: nextRelationships });
          }
        } else if (relationship.description !== undefined && (relationship.currentDescription === undefined || relationship.currentDescription === current?.description)) {
          nextRelationships = [...relationships.filter((value) => value.subjectId !== subjectId), { subjectId, description: relationship.description }];
          changes.push({ target: "relationships", operation: relationship.operation, before, after: nextRelationships });
        }
      }
      if (changes.length > 0) await stateRepository.update(input.agentId, row.version, { mood: nextMood, relationships: nextRelationships });
      if (changes.length > 0) await client.insert(stateChanges).values(changes.map((change) => ({ id: this.ids.next(), runId: input.sourceRunId, target: change.target, operation: change.operation, before: change.before, after: change.after, reason: "Experience Integration", evidenceIds: [input.sourceEvent.id] })));
      const memory = new MemoryWriteService(client, this.ids, this.now); const subjects = memorySubjectsForIntegration(input, output.memories, this.subjects, actor);
      for (const [index, candidate] of output.memories.entries()) {
        const intent: MemoryIntent = { ...candidate, evidenceEventIds: [input.sourceEvent.id], confidence: "medium", purpose: candidate.perspective === "user" ? "user-context" : "self-guidance" };
        const options: MemoryWriteOptions = { sourceEventId: input.sourceEvent.id, sourceRunId: input.sourceRunId, sourceKind: "experience-integration", sourceId: input.integrationId, intentIndex: 10_000 + index, subjectIds: subjects[index] ?? [], ...(embeddings[index] === undefined ? {} : { embedding: embeddings[index] }) };
        failedIntent = intent; failedOptions = options;
        await memory.apply(input.agentId, intent, options);
        failedIntent = undefined; failedOptions = undefined;
      }
      const subjectsForExperience = subjectId === undefined ? [] : [subjectId];
      const vector = experienceEmbedding?.vector === undefined ? null : [...experienceEmbedding.vector];
      const status = experienceEmbedding?.status ?? "pending";
      await client.insert(eventExperiences).values({ eventId: input.sourceEvent.id, integrationId: input.integrationId, summary: output.experience.summary, facts: output.experience.facts }).onConflictDoNothing();
      if (subjectsForExperience.length > 0) await client.insert(eventSubjects).values(subjectsForExperience.map((subjectId) => ({ eventId: input.sourceEvent.id, subjectId }))).onConflictDoNothing();
      await client.insert(eventProjections).values({ eventId: input.sourceEvent.id, contentHash: experienceHash(output.experience), embedding: vector, embeddingModel: experienceEmbedding?.model ?? null, embeddingDimension: experienceEmbedding?.dimension ?? null, embeddingStatus: status, embeddingError: experienceEmbedding?.error ?? null, embeddingLastAttemptAt: new Date() }).onConflictDoUpdate({ target: eventProjections.eventId, set: { contentHash: experienceHash(output.experience), embedding: vector, embeddingModel: experienceEmbedding?.model ?? null, embeddingDimension: experienceEmbedding?.dimension ?? null, embeddingStatus: status, embeddingError: experienceEmbedding?.error ?? null, embeddingLastAttemptAt: new Date(), updatedAt: new Date() } });
      await client.update(experienceIntegrations).set({ status: "completed", output, applied: { memoryCount: output.memories.length, stateChanges: changes.map(({ target, operation }) => ({ target, operation })) }, failureReason: null, completedAt: new Date(), updatedAt: new Date() }).where(eq(experienceIntegrations.id, input.integrationId));
    }); } catch (error) { if (failedIntent !== undefined && failedOptions !== undefined) await recordMemoryMutationFailure(this.database.native, input.agentId, failedIntent, failedOptions, error, this.now()); throw error; }
  }
  async fail(input: ExperienceIntegrationInput, error: unknown): Promise<void> { await this.database.db.update(experienceIntegrations).set({ status: "failed", failureReason: JSON.stringify(errorLogContext(error)), completedAt: new Date(), updatedAt: new Date() }).where(eq(experienceIntegrations.id, input.integrationId)); }
  async missingEventExperienceCandidates(agentId?: string): Promise<readonly { id: string; agentId: string }[]> {
    const owner = agentId === undefined ? undefined : eq(events.agentId, agentId);
    const candidates = await this.database.db.select({ id: experienceIntegrations.id, agentId: events.agentId }).from(experienceIntegrations)
      .innerJoin(agentRuns, eq(agentRuns.id, experienceIntegrations.sourceRunId))
      .innerJoin(events, eq(events.id, agentRuns.eventId))
      .leftJoin(eventExperiences, eq(eventExperiences.eventId, events.id))
      .where(and(eq(experienceIntegrations.status, "completed"), ne(events.kind, "tool-result"), isNull(eventExperiences.eventId), owner,
        sql`${events.occurredAt}>coalesce((select coalesce(nullif(r.input->>'eventWindowEnd','')::timestamptz,r.completed_at) from app.reflection_runs r where r.agent_id=${events.agentId} and r.status='completed' order by r.completed_at desc,r.id desc limit 1),'-infinity'::timestamptz)`))
      .orderBy(asc(events.occurredAt), asc(experienceIntegrations.id));
    return candidates;
  }
  async completedByIds(ids: readonly string[]): Promise<readonly ExperienceIntegrationInput[]> {
    if (ids.length === 0) return [];
    return this.#restorePending(await this.#inputs(["completed"], [...new Set(ids)]));
  }
  async repairEventExperience(input: ExperienceIntegrationInput, value: unknown): Promise<void> {
    const experience = EventExperienceSchema.parse(value);
    const embedded = this.embedding === undefined ? undefined : await this.embedding.prepareMemory(experienceContent(experience));
    const subjectId = this.subjects?.resolve(sourceActor(input.sourceEvent));
    const subjects = subjectId === undefined ? [] : [subjectId];
    const status = embedded?.status ?? "pending";
    await this.database.transaction(async (client) => {
      await client.insert(eventExperiences).values({ eventId: input.sourceEvent.id, integrationId: input.integrationId, summary: experience.summary, facts: experience.facts }).onConflictDoNothing();
      if (subjects.length > 0) await client.insert(eventSubjects).values(subjects.map((subjectId) => ({ eventId: input.sourceEvent.id, subjectId }))).onConflictDoNothing();
      await client.insert(eventProjections).values({ eventId: input.sourceEvent.id, contentHash: experienceHash(experience), embedding: embedded?.vector === undefined ? null : [...embedded.vector], embeddingModel: embedded?.model ?? null, embeddingDimension: embedded?.dimension ?? null, embeddingStatus: status, embeddingError: embedded?.error ?? null, embeddingLastAttemptAt: new Date() }).onConflictDoUpdate({ target: eventProjections.eventId, set: { contentHash: experienceHash(experience), embedding: embedded?.vector === undefined ? null : [...embedded.vector], embeddingModel: embedded?.model ?? null, embeddingDimension: embedded?.dimension ?? null, embeddingStatus: status, embeddingError: embedded?.error ?? null, embeddingLastAttemptAt: new Date(), updatedAt: new Date() } });
      await client.update(experienceIntegrations).set({ output: sql`jsonb_set(coalesce(${experienceIntegrations.output},'{}'::jsonb),'{experience}',${JSON.stringify(experience)}::jsonb,true)`, applied: sql`coalesce(${experienceIntegrations.applied},'{}'::jsonb)||${JSON.stringify({ eventExperienceRepaired: true })}::jsonb`, updatedAt: new Date() }).where(eq(experienceIntegrations.id, input.integrationId));
    });
  }
  async pending(agentId?: string): Promise<readonly ExperienceIntegrationInput[]> {
    return this.#restorePending(await this.#inputs(["pending", "failed"], undefined, agentId));
  }
  async pendingByIds(ids: readonly string[]): Promise<readonly ExperienceIntegrationInput[]> {
    if (ids.length === 0) return [];
    return this.#restorePending(await this.#inputs(["pending", "failed"], [...new Set(ids)]));
  }
  #restorePending(rows: readonly PendingIntegrationRow[]): readonly ExperienceIntegrationInput[] {
    return rows.map((row) => ({ integrationId: row.id, agentId: row.agent_id, sourceEvent: { id: row.source_event_id, agentId: row.agent_id, kind: row.kind, occurredAt: row.occurred_at.toISOString(), payload: row.observation }, sourceRunId: row.source_run_id, input: parseDecisionInput(row.input_snapshot), result: AgentRunResultSchema.parse(row.result) }));
  }
  async #inputs(statuses: readonly string[], ids?: readonly string[], agentId?: string): Promise<PendingIntegrationRow[]> {
    return this.database.db.select({ id: experienceIntegrations.id, agent_id: events.agentId, source_event_id: events.id, source_run_id: experienceIntegrations.sourceRunId, kind: events.kind, occurred_at: events.occurredAt, observation: events.observation, input_snapshot: agentRuns.inputSnapshot, result: agentRuns.result }).from(experienceIntegrations)
      .innerJoin(agentRuns, eq(agentRuns.id, experienceIntegrations.sourceRunId))
      .innerJoin(events, eq(events.id, agentRuns.eventId))
      .where(and(inArray(experienceIntegrations.status, [...statuses]), ids === undefined ? undefined : inArray(experienceIntegrations.id, [...ids]), agentId === undefined ? undefined : eq(events.agentId, agentId)))
      .orderBy(asc(experienceIntegrations.createdAt), asc(experienceIntegrations.id)) as Promise<PendingIntegrationRow[]>;
  }
  async claim(integrationId: string): Promise<boolean> { return (await this.database.db.update(experienceIntegrations).set({ status: "processing", updatedAt: new Date() }).where(and(eq(experienceIntegrations.id, integrationId), inArray(experienceIntegrations.status, ["pending", "failed"]))).returning({ id: experienceIntegrations.id })).length === 1; }
}
