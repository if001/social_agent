import type { Pool } from "pg";

import { EventExperienceSchema, memorySubjectsForIntegration, type ExperienceIntegrationInput, type ExperienceIntegrationOutput, type ExperienceIntegrationRepository } from "../../application/experience-integration.js";
import type { IdGenerator, MemoryEmbeddingPreparer } from "../../application/ports.js";
import { MemoryWriteService } from "../../application/memory-write-service.js";
import { errorLogContext } from "../../observability/logger.js";
import { AgentStateRepository, PostgresUnitOfWork } from "./postgres.js";
import { AgentCoreInputSchema, AgentRunResultSchema, type DomainEvent, type MemoryIntent } from "../../domain/contracts.js";

type PendingIntegrationRow = { id: string; agent_id: string; source_event_id: string; source_run_id: string; input: { event: { id: string; kind: DomainEvent["kind"]; occurredAt: string; payload: Record<string, unknown> }; decisionInput: unknown; result: Record<string, unknown>; toolExecutions?: unknown } };

function snapshot(input: ExperienceIntegrationInput): Record<string, unknown> { return { event: { id: input.sourceEvent.id, kind: input.sourceEvent.kind, occurredAt: input.sourceEvent.occurredAt, payload: input.sourceEvent.payload }, decisionInput: input.input, result: { assessment: input.result.assessment, output: input.result.output, toolExecutions: input.result.toolExecutions } }; }

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
    const result = await this.pool.query("INSERT INTO experience_integrations(id,agent_id,source_event_id,source_run_id,status,input) VALUES ($1,$2,$3,$4,'pending',$5) ON CONFLICT (agent_id,source_run_id) DO NOTHING RETURNING id", [input.integrationId, input.agentId, input.sourceEvent.id, input.sourceRunId, JSON.stringify(snapshot(input))]);
    return result.rowCount === 1 ? "created" : "duplicate";
  }
  async apply(input: ExperienceIntegrationInput, output: ExperienceIntegrationOutput): Promise<void> {
    const embedding = this.embedding;
    const embeddings = embedding === undefined ? [] : await Promise.all(output.memories.map(({ content }) => embedding.prepareMemory(content)));
    const experienceEmbedding = embedding === undefined ? undefined : await embedding.prepareMemory(output.experience.summary);
    await new PostgresUnitOfWork(this.pool).transaction(async (client) => {
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
        await memory.apply(input.agentId, intent, { sourceEventId: input.sourceEvent.id, intentIndex: 10_000 + index, subjectIds: subjects[index] ?? [], ...(embeddings[index] === undefined ? {} : { embedding: embeddings[index] }) });
      }
      const subjectsForExperience = actor?.type === "human" || actor?.type === "agent" ? [actor.id] : [];
      const vector = experienceEmbedding?.vector === undefined ? null : `[${experienceEmbedding.vector.join(",")}]`;
      const status = experienceEmbedding?.status ?? "pending";
      await client.query("INSERT INTO event_experiences(event_id,agent_id,integration_id,summary,facts,subjects,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_id) DO NOTHING", [input.sourceEvent.id, input.agentId, input.integrationId, output.experience.summary, JSON.stringify(output.experience.facts), JSON.stringify(subjectsForExperience), input.sourceEvent.occurredAt]);
      await client.query("INSERT INTO event_projections(event_id,agent_id,kind,content,subjects,occurred_at,embedding,embedding_status) VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8) ON CONFLICT (event_id) DO UPDATE SET agent_id=EXCLUDED.agent_id,kind=EXCLUDED.kind,content=EXCLUDED.content,subjects=EXCLUDED.subjects,occurred_at=EXCLUDED.occurred_at,embedding=EXCLUDED.embedding,embedding_status=EXCLUDED.embedding_status", [input.sourceEvent.id, input.agentId, input.sourceEvent.kind, output.experience.summary, JSON.stringify(subjectsForExperience), input.sourceEvent.occurredAt, vector, status]);
      await client.query("UPDATE experience_integrations SET status='completed',output=$2,applied=$3,failure_reason=NULL,completed_at=now(),updated_at=now() WHERE id=$1", [input.integrationId, JSON.stringify(output), JSON.stringify({ memoryCount: output.memories.length, stateChanges: changes.map(({ target, operation }) => ({ target, operation })) })]);
    });
  }
  async fail(input: ExperienceIntegrationInput, error: unknown): Promise<void> { await this.pool.query("UPDATE experience_integrations SET status='failed',failure_reason=$2,completed_at=now(),updated_at=now() WHERE id=$1", [input.integrationId, JSON.stringify(errorLogContext(error))]); }
  async missingEventExperienceCandidates(agentId?: string): Promise<readonly { id: string; agentId: string }[]> {
    const candidates = await this.pool.query<{ id: string; agent_id: string }>(`SELECT i.id,i.agent_id
      FROM experience_integrations i
      JOIN events e ON e.id=i.source_event_id
      LEFT JOIN event_experiences x ON x.event_id=i.source_event_id
      WHERE i.status='completed' AND e.kind<>'tool-result' AND x.event_id IS NULL
        AND ($1::text IS NULL OR i.agent_id=$1)
        AND e.occurred_at>COALESCE((SELECT COALESCE(NULLIF(r.input->>'eventWindowEnd','')::timestamptz,r.completed_at)
          FROM reflection_runs r WHERE r.agent_id=i.agent_id AND r.status='completed'
          ORDER BY r.completed_at DESC,r.id DESC LIMIT 1),'-infinity'::timestamptz)
      ORDER BY e.occurred_at,i.id`, [agentId ?? null]);
    return candidates.rows.map(({ id, agent_id: resultAgentId }) => ({ id, agentId: resultAgentId }));
  }
  async completedByIds(ids: readonly string[]): Promise<readonly ExperienceIntegrationInput[]> {
    if (ids.length === 0) return [];
    const result = await this.pool.query<PendingIntegrationRow>("SELECT id,agent_id,source_event_id,source_run_id,input FROM experience_integrations WHERE status='completed' AND id=ANY($1::text[]) ORDER BY created_at,id", [[...new Set(ids)]]);
    return this.#restorePending(result.rows);
  }
  async repairEventExperience(input: ExperienceIntegrationInput, value: unknown): Promise<void> {
    const experience = EventExperienceSchema.parse(value);
    const embedded = this.embedding === undefined ? undefined : await this.embedding.prepareMemory(experience.summary);
    const actor = input.input.observation.actor;
    const subjects = actor?.type === "human" || actor?.type === "agent" ? [actor.id] : [];
    const vector = embedded?.vector === undefined ? null : `[${embedded.vector.join(",")}]`;
    const status = embedded?.status ?? "pending";
    await new PostgresUnitOfWork(this.pool).transaction(async (client) => {
      await client.query("INSERT INTO event_experiences(event_id,agent_id,integration_id,summary,facts,subjects,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (event_id) DO NOTHING", [input.sourceEvent.id, input.agentId, input.integrationId, experience.summary, JSON.stringify(experience.facts), JSON.stringify(subjects), input.sourceEvent.occurredAt]);
      await client.query("INSERT INTO event_projections(event_id,agent_id,kind,content,subjects,occurred_at,embedding,embedding_status) VALUES ($1,$2,$3,$4,$5,$6,$7::vector,$8) ON CONFLICT (event_id) DO UPDATE SET agent_id=EXCLUDED.agent_id,kind=EXCLUDED.kind,content=EXCLUDED.content,subjects=EXCLUDED.subjects,occurred_at=EXCLUDED.occurred_at,embedding=EXCLUDED.embedding,embedding_status=EXCLUDED.embedding_status", [input.sourceEvent.id, input.agentId, input.sourceEvent.kind, experience.summary, JSON.stringify(subjects), input.sourceEvent.occurredAt, vector, status]);
      await client.query("UPDATE experience_integrations SET output=jsonb_set(COALESCE(output,'{}'::jsonb),'{experience}',$2::jsonb,true),applied=COALESCE(applied,'{}'::jsonb)||$3::jsonb,updated_at=now() WHERE id=$1 AND status='completed'", [input.integrationId, JSON.stringify(experience), JSON.stringify({ eventExperienceRepaired: true })]);
    });
  }
  async pending(agentId?: string): Promise<readonly ExperienceIntegrationInput[]> {
    const result = await this.pool.query<PendingIntegrationRow>("SELECT id,agent_id,source_event_id,source_run_id,input FROM experience_integrations WHERE status IN ('pending','failed') AND ($1::text IS NULL OR agent_id=$1) ORDER BY created_at,id", [agentId ?? null]);
    return this.#restorePending(result.rows);
  }
  async pendingByIds(ids: readonly string[]): Promise<readonly ExperienceIntegrationInput[]> {
    if (ids.length === 0) return [];
    const result = await this.pool.query<PendingIntegrationRow>("SELECT id,agent_id,source_event_id,source_run_id,input FROM experience_integrations WHERE status IN ('pending','failed') AND id=ANY($1::text[]) ORDER BY created_at,id", [[...new Set(ids)]]);
    return this.#restorePending(result.rows);
  }
  #restorePending(rows: readonly PendingIntegrationRow[]): readonly ExperienceIntegrationInput[] {
    return rows.map((row) => ({ integrationId: row.id, agentId: row.agent_id, sourceEvent: { id: row.input.event.id, agentId: row.agent_id, kind: row.input.event.kind, occurredAt: row.input.event.occurredAt, payload: row.input.event.payload }, sourceRunId: row.source_run_id, input: parseDecisionInput(row.input.decisionInput), result: AgentRunResultSchema.parse({ ...row.input.result, toolExecutions: row.input.result.toolExecutions ?? row.input.toolExecutions ?? [] }) }));
  }
  async claim(integrationId: string): Promise<boolean> { return (await this.pool.query("UPDATE experience_integrations SET status='processing',updated_at=now() WHERE id=$1 AND status IN ('pending','failed')", [integrationId])).rowCount === 1; }
}
