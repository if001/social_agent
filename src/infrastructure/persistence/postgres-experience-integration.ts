import { createHash } from "node:crypto";
import type { Pool } from "pg";

import { EventExperienceSchema, memorySubjectsForIntegration, type ExperienceIntegrationInput, type ExperienceIntegrationOutput, type ExperienceIntegrationRepository } from "../../application/experience-integration.js";
import type { IdGenerator, MemoryEmbeddingPreparer } from "../../application/ports.js";
import { MemoryWriteService, recordMemoryMutationFailure, type MemoryWriteOptions } from "./memory-write-repository.js";
import { errorLogContext } from "../../observability/logger.js";
import { AgentStateRepository, PostgresUnitOfWork } from "./postgres.js";
import { AgentCoreInputSchema, AgentRunResultSchema, type DomainEvent, type MemoryIntent } from "../../domain/contracts.js";

type PendingIntegrationRow = { id: string; agent_id: string; source_event_id: string; source_run_id: string; kind: DomainEvent["kind"]; occurred_at: Date; observation: Record<string, unknown>; input_snapshot: unknown; result: Record<string, unknown> };
const experienceContent = (experience: { readonly summary: string; readonly facts: readonly string[] }) => `${experience.summary}\n${experience.facts.join("\n")}`;
const experienceHash = (experience: { readonly summary: string; readonly facts: readonly string[] }) => createHash("sha256").update(experienceContent(experience)).digest("hex");

/** Removes the short-lived RuntimeExecutionInput extension written before C-23's boundary was enforced. */
function parseDecisionInput(value: unknown) {
  if (typeof value === "object" && value !== null && "persistentState" in value) {
    const coreInput = { ...(value as Record<string, unknown>) };
    delete coreInput.persistentState;
    return AgentCoreInputSchema.parse(coreInput);
  }
  return AgentCoreInputSchema.parse(value);
}

export class PostgresExperienceIntegrationRepository implements ExperienceIntegrationRepository {
  constructor(private readonly pool: Pool, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly embedding?: MemoryEmbeddingPreparer) {}
  async begin(input: ExperienceIntegrationInput): Promise<"created" | "duplicate"> {
    const result = await this.pool.query("INSERT INTO experience_integrations(id,source_run_id,status) VALUES ($1,$2,'pending') ON CONFLICT (source_run_id) DO NOTHING RETURNING id", [input.integrationId, input.sourceRunId]);
    return result.rowCount === 1 ? "created" : "duplicate";
  }
  async apply(input: ExperienceIntegrationInput, output: ExperienceIntegrationOutput): Promise<void> {
    const embedding = this.embedding;
    const embeddings = embedding === undefined ? [] : await Promise.all(output.memories.map(({ content }) => embedding.prepareMemory(content)));
    const experienceEmbedding = embedding === undefined ? undefined : await embedding.prepareMemory(experienceContent(output.experience));
    let failedIntent: MemoryIntent | undefined; let failedOptions: MemoryWriteOptions | undefined;
    try { await new PostgresUnitOfWork(this.pool).transaction(async (client) => {
      const stateRepository = new AgentStateRepository(client);
      const row = await stateRepository.find<{ version: number; mood: string; relationships: unknown }>(input.agentId);
      if (row === undefined) throw new Error("Agent state is unavailable for Experience Integration");
      const relationships = Array.isArray(row.relationships) ? row.relationships as { subjectId: string; description: string }[] : [];
      let nextRelationships = relationships; let nextMood = row.mood;
      const changes: { target: string; operation: string; before: unknown; after: unknown }[] = [];
      if (output.mood !== undefined && output.mood !== row.mood) { nextMood = output.mood; changes.push({ target: "mood", operation: "set", before: row.mood, after: nextMood }); }
      const actor = input.input.observation.actor;
      const actorId = actor?.type === "human" || actor?.type === "agent" ? actor.id : undefined;
      if (output.relationship !== undefined && actorId !== undefined) {
        const before = relationships;
        const relationship = output.relationship;
        const current = relationships.find(({ subjectId }) => subjectId === actorId);
        if (relationship.operation === "remove") {
          if (current !== undefined && relationship.currentDescription === current.description) {
            nextRelationships = relationships.filter(({ subjectId }) => subjectId !== actorId);
            changes.push({ target: "relationships", operation: relationship.operation, before, after: nextRelationships });
          }
        } else if (relationship.description !== undefined && (relationship.currentDescription === undefined || relationship.currentDescription === current?.description)) {
          nextRelationships = [...relationships.filter(({ subjectId }) => subjectId !== actorId), { subjectId: actorId, description: relationship.description }];
          changes.push({ target: "relationships", operation: relationship.operation, before, after: nextRelationships });
        }
      }
      if (changes.length > 0) await stateRepository.update(input.agentId, row.version, { mood: nextMood, relationships: nextRelationships });
      for (const change of changes) await client.query("INSERT INTO state_changes(id,run_id,target,operation,before,after,reason,evidence_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [this.ids.next(), input.sourceRunId, change.target, change.operation, JSON.stringify(change.before), JSON.stringify(change.after), "Experience Integration", JSON.stringify([input.sourceEvent.id])]);
      const memory = new MemoryWriteService(client, this.ids, this.now); const subjects = memorySubjectsForIntegration(input, output.memories);
      for (const [index, candidate] of output.memories.entries()) {
        const intent: MemoryIntent = { ...candidate, evidenceEventIds: [input.sourceEvent.id], confidence: "medium", purpose: candidate.perspective === "user" ? "user-context" : "self-guidance" };
        const options: MemoryWriteOptions = { sourceEventId: input.sourceEvent.id, sourceRunId: input.sourceRunId, sourceKind: "experience-integration", sourceId: input.integrationId, intentIndex: 10_000 + index, subjectIds: subjects[index] ?? [], ...(embeddings[index] === undefined ? {} : { embedding: embeddings[index] }) };
        failedIntent = intent; failedOptions = options;
        await memory.apply(input.agentId, intent, options);
        failedIntent = undefined; failedOptions = undefined;
      }
      const subjectsForExperience = actor?.type === "human" || actor?.type === "agent" ? [actor.id] : [];
      const vector = experienceEmbedding?.vector === undefined ? null : `[${experienceEmbedding.vector.join(",")}]`;
      const status = experienceEmbedding?.status ?? "pending";
      await client.query("INSERT INTO event_experiences(event_id,integration_id,summary,facts) VALUES ($1,$2,$3,$4) ON CONFLICT (event_id) DO NOTHING", [input.sourceEvent.id, input.integrationId, output.experience.summary, JSON.stringify(output.experience.facts)]);
      for (const subjectId of subjectsForExperience) await client.query("INSERT INTO event_subjects(event_id,subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [input.sourceEvent.id, subjectId]);
      await client.query("INSERT INTO event_projections(event_id,content_hash,embedding,embedding_model,embedding_dimension,embedding_status,embedding_error,embedding_last_attempt_at) VALUES ($1,$2,$3::vector,$4,$5,$6,$7,now()) ON CONFLICT (event_id) DO UPDATE SET content_hash=EXCLUDED.content_hash,embedding=EXCLUDED.embedding,embedding_model=EXCLUDED.embedding_model,embedding_dimension=EXCLUDED.embedding_dimension,embedding_status=EXCLUDED.embedding_status,embedding_error=EXCLUDED.embedding_error,embedding_last_attempt_at=EXCLUDED.embedding_last_attempt_at,updated_at=now()", [input.sourceEvent.id, experienceHash(output.experience), vector, experienceEmbedding?.model ?? null, experienceEmbedding?.dimension ?? null, status, experienceEmbedding?.error ?? null]);
      await client.query("UPDATE experience_integrations SET status='completed',output=$2,applied=$3,failure_reason=NULL,completed_at=now(),updated_at=now() WHERE id=$1", [input.integrationId, JSON.stringify(output), JSON.stringify({ memoryCount: output.memories.length, stateChanges: changes.map(({ target, operation }) => ({ target, operation })) })]);
    }); } catch (error) { if (failedIntent !== undefined && failedOptions !== undefined) await recordMemoryMutationFailure(this.pool, input.agentId, failedIntent, failedOptions, error, this.now()); throw error; }
  }
  async fail(input: ExperienceIntegrationInput, error: unknown): Promise<void> { await this.pool.query("UPDATE experience_integrations SET status='failed',failure_reason=$2,completed_at=now(),updated_at=now() WHERE id=$1", [input.integrationId, JSON.stringify(errorLogContext(error))]); }
  async missingEventExperienceCandidates(agentId?: string): Promise<readonly { id: string; agentId: string }[]> {
    const candidates = await this.pool.query<{ id: string; agent_id: string }>(`SELECT i.id,e.agent_id
      FROM experience_integrations i
      JOIN agent_runs ar ON ar.id=i.source_run_id
      JOIN events e ON e.id=ar.event_id
      LEFT JOIN event_experiences x ON x.event_id=e.id
      WHERE i.status='completed' AND e.kind<>'tool-result' AND x.event_id IS NULL
        AND ($1::text IS NULL OR e.agent_id=$1)
        AND e.occurred_at>COALESCE((SELECT COALESCE(NULLIF(r.input->>'eventWindowEnd','')::timestamptz,r.completed_at)
          FROM reflection_runs r WHERE r.agent_id=e.agent_id AND r.status='completed'
          ORDER BY r.completed_at DESC,r.id DESC LIMIT 1),'-infinity'::timestamptz)
      ORDER BY e.occurred_at,i.id`, [agentId ?? null]);
    return candidates.rows.map(({ id, agent_id: resultAgentId }) => ({ id, agentId: resultAgentId }));
  }
  async completedByIds(ids: readonly string[]): Promise<readonly ExperienceIntegrationInput[]> {
    if (ids.length === 0) return [];
    const result = await this.#inputs("i.status='completed' AND i.id=ANY($1::text[])", [[...new Set(ids)]]);
    return this.#restorePending(result.rows);
  }
  async repairEventExperience(input: ExperienceIntegrationInput, value: unknown): Promise<void> {
    const experience = EventExperienceSchema.parse(value);
    const embedded = this.embedding === undefined ? undefined : await this.embedding.prepareMemory(experienceContent(experience));
    const actor = input.input.observation.actor;
    const subjects = actor?.type === "human" || actor?.type === "agent" ? [actor.id] : [];
    const vector = embedded?.vector === undefined ? null : `[${embedded.vector.join(",")}]`;
    const status = embedded?.status ?? "pending";
    await new PostgresUnitOfWork(this.pool).transaction(async (client) => {
      await client.query("INSERT INTO event_experiences(event_id,integration_id,summary,facts) VALUES ($1,$2,$3,$4) ON CONFLICT (event_id) DO NOTHING", [input.sourceEvent.id, input.integrationId, experience.summary, JSON.stringify(experience.facts)]);
      for (const subjectId of subjects) await client.query("INSERT INTO event_subjects(event_id,subject_id) VALUES ($1,$2) ON CONFLICT DO NOTHING", [input.sourceEvent.id, subjectId]);
      await client.query("INSERT INTO event_projections(event_id,content_hash,embedding,embedding_model,embedding_dimension,embedding_status,embedding_error,embedding_last_attempt_at) VALUES ($1,$2,$3::vector,$4,$5,$6,$7,now()) ON CONFLICT (event_id) DO UPDATE SET content_hash=EXCLUDED.content_hash,embedding=EXCLUDED.embedding,embedding_model=EXCLUDED.embedding_model,embedding_dimension=EXCLUDED.embedding_dimension,embedding_status=EXCLUDED.embedding_status,embedding_error=EXCLUDED.embedding_error,embedding_last_attempt_at=EXCLUDED.embedding_last_attempt_at,updated_at=now()", [input.sourceEvent.id, experienceHash(experience), vector, embedded?.model ?? null, embedded?.dimension ?? null, status, embedded?.error ?? null]);
      await client.query("UPDATE experience_integrations SET output=jsonb_set(COALESCE(output,'{}'::jsonb),'{experience}',$2::jsonb,true),applied=COALESCE(applied,'{}'::jsonb)||$3::jsonb,updated_at=now() WHERE id=$1 AND status='completed'", [input.integrationId, JSON.stringify(experience), JSON.stringify({ eventExperienceRepaired: true })]);
    });
  }
  async pending(agentId?: string): Promise<readonly ExperienceIntegrationInput[]> {
    const result = await this.#inputs("i.status IN ('pending','failed') AND ($1::text IS NULL OR e.agent_id=$1)", [agentId ?? null]);
    return this.#restorePending(result.rows);
  }
  async pendingByIds(ids: readonly string[]): Promise<readonly ExperienceIntegrationInput[]> {
    if (ids.length === 0) return [];
    const result = await this.#inputs("i.status IN ('pending','failed') AND i.id=ANY($1::text[])", [[...new Set(ids)]]);
    return this.#restorePending(result.rows);
  }
  #restorePending(rows: readonly PendingIntegrationRow[]): readonly ExperienceIntegrationInput[] {
    return rows.map((row) => ({ integrationId: row.id, agentId: row.agent_id, sourceEvent: { id: row.source_event_id, agentId: row.agent_id, kind: row.kind, occurredAt: row.occurred_at.toISOString(), payload: row.observation }, sourceRunId: row.source_run_id, input: parseDecisionInput(row.input_snapshot), result: AgentRunResultSchema.parse(row.result) }));
  }
  async #inputs(where: string, values: readonly unknown[]): Promise<{ rows: PendingIntegrationRow[] }> {
    return this.pool.query<PendingIntegrationRow>(`SELECT i.id,e.agent_id,e.id AS source_event_id,i.source_run_id,e.kind,e.occurred_at,e.observation,r.input_snapshot,r.result
      FROM experience_integrations i JOIN agent_runs r ON r.id=i.source_run_id JOIN events e ON e.id=r.event_id
      WHERE ${where} ORDER BY i.created_at,i.id`, [...values]);
  }
  async claim(integrationId: string): Promise<boolean> { return (await this.pool.query("UPDATE experience_integrations SET status='processing',updated_at=now() WHERE id=$1 AND status IN ('pending','failed')", [integrationId])).rowCount === 1; }
}
