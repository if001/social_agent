import type { Pool, QueryResultRow } from "pg";
import { errorLogContext } from "../../observability/logger.js";

import type { PendingOutput, PendingPostProcess, PostProcessOutput, RuntimePersistence } from "../../application/agent-runtime.js";
import type { IdGenerator } from "../../application/ports.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { applyMotiveProposals, StateUpdateService, type StateUpdateResult } from "../../application/state-update-service.js";
import { CandidateDetectionInputSchema, CandidateDetectionOutputSchema, ContinuityInputSchema, ContinuityOutputSchema, DomainError, ExperienceIntegrationOutputSchema, MemoryExtractionInputSchema, MemoryExtractionOutputSchema, type AgentCoreInput, type AgentRunResult, type Candidate, type DomainEvent, type Memory, type MemoryExtractionOutput, type MessageEnvelope, type PostProcessSnapshot, type ToolExecutionRecord } from "../../domain/contracts.js";
import { PostgresEventTransaction } from "./event-transaction.js";
import type { MemoryEmbeddingLifecycle } from "./postgres-memory-embedding.js";
import { PostgresUnitOfWork } from "./postgres.js";

type RuntimeInputLoader = (event: DomainEvent) => Promise<AgentCoreInput>;
type OutboxRow = QueryResultRow & { id: string; envelope: MessageEnvelope };

export class PostgresRuntimePersistence implements RuntimePersistence {
  readonly #transaction: PostgresEventTransaction;
  constructor(private readonly pool: Pool, private readonly inputLoader: RuntimeInputLoader, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly memoryEmbedding?: MemoryEmbeddingLifecycle, tools?: ToolRegistry) { this.#transaction = new PostgresEventTransaction(new PostgresUnitOfWork(pool), tools); }

  async hasReceipt(destination: string, messageId: string): Promise<boolean> { return (await this.pool.query("SELECT 1 FROM message_receipts WHERE destination=$1 AND message_id=$2 AND status='completed'", [destination, messageId])).rowCount === 1; }
  loadInput(event: DomainEvent): Promise<AgentCoreInput> { return this.inputLoader(event); }
  async authorizeInbound(event: DomainEvent, messageId: string, maxEventsPerMinute: number): Promise<void> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const correlation = event.correlationId ?? event.id;
      const claimed = await client.query<{ message_id: string }>("INSERT INTO runtime_correlations(agent_id,correlation_id,message_id) VALUES ($1,$2,$3) ON CONFLICT (agent_id,correlation_id) DO UPDATE SET message_id=runtime_correlations.message_id RETURNING message_id", [event.agentId, correlation, messageId]);
      if (claimed.rows[0]?.message_id !== messageId) throw new DomainError("VALIDATION", "Correlation loop detected");
      const rate = await client.query<{ event_count: number }>("INSERT INTO runtime_rate_windows(agent_id,window_start,event_count) VALUES ($1,date_trunc('minute',now()),1) ON CONFLICT (agent_id,window_start) DO UPDATE SET event_count=runtime_rate_windows.event_count+1 RETURNING event_count", [event.agentId]);
      if ((rate.rows[0]?.event_count ?? 0) > maxEventsPerMinute) throw new DomainError("VALIDATION", "Agent event rate limit exceeded");
      await client.query("COMMIT");
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }
  async commit(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, result: AgentRunResult, update: StateUpdateResult, outgoing: readonly MessageEnvelope[]): Promise<"committed" | "duplicate"> {
    const validatedTools = this.#validateTools(input, result.toolExecutions).map((execution) => ({ ...execution, id: this.ids.next() }));
    const committed = await this.#transaction.commit({
      destination: message.destination, messageId: message.id,
      event: { id: event.id, agentId: event.agentId, kind: event.kind, observation: input.observation, source: message.source, occurredAt: new Date(event.occurredAt), ...(event.causationId === undefined ? {} : { causationId: event.causationId }), ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }) },
      run: { id: input.run.runId, inputStateVersion: input.self.version, startedAt: new Date(input.run.occurredAt), result: { ...result, memoryRetrievalTrace: input.memoryRetrievalTrace } },
      stateValues: { mood: update.state.mood, emotion: update.state.emotion ?? null, motives: update.state.motives, motive_exploration: update.state.motiveExploration },
      changes: update.changes.map((change) => ({ ...change, id: this.ids.next() })),
      toolExecutions: validatedTools,
      outbox: outgoing
    });
    return committed;
  }

  async recordFailure(message: MessageEnvelope, event: DomainEvent, input: AgentCoreInput, error: unknown, toolExecutions: readonly ToolExecutionRecord[]): Promise<void> {
    const validatedTools = this.#validateTools(input, toolExecutions).map((execution) => ({ ...execution, id: this.ids.next() }));
    await this.#transaction.recordFailure({
      destination: message.destination, messageId: message.id,
      event: { id: event.id, agentId: event.agentId, kind: event.kind, observation: input.observation, source: message.source, occurredAt: new Date(event.occurredAt), ...(event.causationId === undefined ? {} : { causationId: event.causationId }), ...(event.correlationId === undefined ? {} : { correlationId: event.correlationId }) },
      run: { id: input.run.runId, inputStateVersion: input.self.version, startedAt: new Date(input.run.occurredAt), result: null },
      toolExecutions: validatedTools,
      failureReason: JSON.stringify(errorLogContext(error))
    });
  }

  async pendingOutbox(limit: number): Promise<readonly PendingOutput[]> {
    const result = await this.pool.query<OutboxRow>("SELECT id,envelope FROM outbox_messages WHERE status='pending' AND available_at<=now() ORDER BY created_at,id LIMIT $1", [limit]);
    return result.rows.map(({ envelope }) => ({ envelope }));
  }
  async markOutboxSent(id: string): Promise<void> { await this.pool.query("UPDATE outbox_messages SET status='sent',sent_at=now() WHERE id=$1", [id]); }

  async claimPostProcess(agentId?: string, runId?: string, type?: PendingPostProcess["type"]): Promise<PendingPostProcess | undefined> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const values: string[] = []; const filters: string[] = [];
      if (agentId !== undefined) { values.push(agentId); filters.push(`agent_id=$${String(values.length)}`); }
      if (runId !== undefined) { values.push(runId); filters.push(`interaction_run_id=$${String(values.length)}`); }
      if (type !== undefined) { values.push(type); filters.push(`job_type=$${String(values.length)}`); }
      const result = await client.query<{ id: string; agent_id: string; job_type: "experience-integration" | "continuity" | "memory" | "candidate"; input_state_version: number; payload: unknown; attempt: number }>(`SELECT id,agent_id,job_type,input_state_version,payload,attempt FROM post_process_jobs WHERE status IN ('pending','failed') AND attempt<2 AND available_at<=now() AND (lease_until IS NULL OR lease_until<now()) ${filters.length === 0 ? "" : `AND ${filters.join(" AND ")}`} ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1`, values);
      const row = result.rows[0];
      if (row === undefined) { await client.query("COMMIT"); return undefined; }
      await client.query("UPDATE post_process_jobs SET status='processing',attempt=attempt+1,lease_until=now()+interval '5 minutes',updated_at=now() WHERE id=$1", [row.id]);
      await client.query("COMMIT");
      const base = { id: row.id, agentId: row.agent_id, inputStateVersion: row.input_state_version, attempt: row.attempt + 1 };
      if (row.job_type === "experience-integration") return { ...base, type: "experience-integration", input: ContinuityInputSchema.parse(row.payload) };
      if (row.job_type === "continuity") return { ...base, type: "continuity", input: ContinuityInputSchema.parse(row.payload) };
      if (row.job_type === "memory") return { ...base, type: "memory", input: MemoryExtractionInputSchema.parse(row.payload) };
      return { ...base, type: "candidate", input: CandidateDetectionInputSchema.parse(row.payload) };
    } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
  }

  async completePostProcess(job: PendingPostProcess, output: PostProcessOutput): Promise<void> {
    if (job.type === "experience-integration") {
      const parsed = ExperienceIntegrationOutputSchema.parse(output);
      const evidenceIds = new Set([job.input.run.eventId, job.input.observation.eventId, ...job.input.recentExperiences.map(({ eventId }) => eventId), ...job.input.memories.map(({ id }) => id)]);
      if (parsed.motiveProposals.some((proposal) => proposal.evidenceIds.some((id) => !evidenceIds.has(id)))) throw new DomainError("VALIDATION", "Motive evidence must reference an input Event or Memory");
      const persistent = new StateUpdateService().apply(job.agentId, job.input.dynamicState, parsed.persistentStateUpdates, job.input.socialContext);
      const motiveUpdates = applyMotiveProposals(persistent.state, parsed.motiveProposals, () => this.ids.next(), job.input.run.occurredAt);
      const memories = await this.#materializeMemories(job.input, parsed);
      const changes = [...persistent.changes, ...motiveUpdates.changes];
      await this.#transaction.commitPostProcess({ jobId: job.id, jobType: job.type, runId: job.input.run.runId, agentId: job.agentId, expectedStateVersion: job.inputStateVersion, stateValues: { mood: motiveUpdates.state.mood, motives: motiveUpdates.state.motives, motive_exploration: motiveUpdates.state.motiveExploration }, changes: changes.map((change) => ({ ...change, id: this.ids.next() })), output: parsed, ...memories });
      if (memories.memories.length > 0) await this.memoryEmbedding?.embedMemoryIds(job.agentId, memories.memories.map(({ id }) => id));
      return;
    }
    if (job.type === "continuity") {
      const parsed = ContinuityOutputSchema.parse(output);
      const evidenceIds = new Set([job.input.run.eventId, job.input.observation.eventId, ...job.input.recentExperiences.map(({ eventId }) => eventId), ...job.input.memories.map(({ id }) => id)]);
      if (parsed.motiveProposals.some((proposal) => proposal.evidenceIds.some((id) => !evidenceIds.has(id)))) throw new DomainError("VALIDATION", "Motive evidence must reference an input Event or Memory");
      const persistent = new StateUpdateService().apply(job.agentId, job.input.dynamicState, parsed.persistentStateUpdates, job.input.socialContext);
      const motiveUpdates = applyMotiveProposals(persistent.state, parsed.motiveProposals, () => this.ids.next(), job.input.run.occurredAt);
      const updates = { state: motiveUpdates.state, changes: [...persistent.changes, ...motiveUpdates.changes] };
      await this.#transaction.commitPostProcess({ jobId: job.id, jobType: job.type, runId: job.input.run.runId, agentId: job.agentId, expectedStateVersion: job.inputStateVersion, stateValues: { mood: updates.state.mood, motives: updates.state.motives, motive_exploration: updates.state.motiveExploration }, changes: updates.changes.map((change) => ({ ...change, id: this.ids.next() })), output: parsed });
      return;
    }
    if (job.type === "memory") {
      const parsed = MemoryExtractionOutputSchema.parse(output); const memories = await this.#materializeMemories(job.input, parsed);
      await this.#transaction.commitPostProcess({ jobId: job.id, jobType: job.type, runId: job.input.run.runId, agentId: job.agentId, expectedStateVersion: job.inputStateVersion, stateValues: {}, changes: [], output: parsed, ...memories });
      if (memories.memories.length > 0) await this.memoryEmbedding?.embedMemoryIds(job.agentId, memories.memories.map(({ id }) => id));
      return;
    }
    const parsed = CandidateDetectionOutputSchema.parse(output); const memoryIds = new Set(job.input.memories.map(({ id }) => id));
    const candidates = [...new Map(parsed.longTermCandidates.map((proposal) => [`${proposal.target}\u0000${proposal.proposal.trim()}`, proposal])).values()].map((proposal): Candidate => {
      if (proposal.evidenceMemoryIds.length === 0 || proposal.evidenceMemoryIds.some((id) => !memoryIds.has(id))) throw new DomainError("VALIDATION", "Candidate evidence must use saved input Memory IDs");
      return { id: this.ids.next(), agentId: job.agentId, ...proposal, evidenceEventIds: [...new Set([...proposal.evidenceEventIds, job.input.run.eventId])], status: "pending", createdAt: job.input.run.occurredAt };
    });
    await this.#transaction.commitPostProcess({ jobId: job.id, jobType: job.type, runId: job.input.run.runId, agentId: job.agentId, expectedStateVersion: job.inputStateVersion, stateValues: {}, changes: [], output: parsed, candidates });
  }

  async failPostProcess(job: PendingPostProcess, error: unknown): Promise<void> {
    await this.pool.query("UPDATE post_process_jobs SET status='failed',failure_reason=$2,lease_until=NULL,available_at=now()+interval '1 second',updated_at=now() WHERE id=$1", [job.id, error instanceof Error ? error.message : "Post-process failed"]);
  }

  async #materializeMemories(input: PostProcessSnapshot, output: MemoryExtractionOutput): Promise<{ readonly memories: readonly Memory[]; readonly memoryWebEvidence: readonly { readonly memoryId: string; readonly snapshotIds: readonly string[] }[] }> {
    const uniqueMemoryProposals = [...new Map(output.memoryProposals.map((proposal) => [proposal.content.trim(), proposal])).values()];
    const referencedSnapshotIds = [...new Set(uniqueMemoryProposals.flatMap(({ webSnapshotIds }) => webSnapshotIds))];
    const observedSnapshotIds = new Set(input.interaction.toolResults.flatMap(({ webSnapshotIds }) => webSnapshotIds));
    if (referencedSnapshotIds.some((id) => !observedSnapshotIds.has(id))) throw new DomainError("VALIDATION", "Memory references a Web Snapshot not observed in this run");
    if (referencedSnapshotIds.length > 0) {
      const owned = await this.pool.query<{ id: string }>("SELECT id FROM web_snapshots WHERE id=ANY($1::text[])", [referencedSnapshotIds]);
      if (owned.rows.length !== referencedSnapshotIds.length) throw new DomainError("VALIDATION", "Memory references a missing Web Snapshot");
    }
    const memories: Memory[] = []; const memoryWebEvidence: { memoryId: string; snapshotIds: readonly string[] }[] = [];
    const sourceAgentId = input.observation.actor?.type === "agent" ? input.observation.actor.id : undefined;
    for (const proposal of uniqueMemoryProposals) { const { webSnapshotIds, ...memoryProposal } = proposal; const memory: Memory = { id: this.ids.next(), agentId: input.run.agentId, kind: "episodic", occurredAt: input.run.occurredAt, createdAt: this.now().toISOString(), ...memoryProposal, ...(sourceAgentId === undefined ? {} : { sourceAgentId }), evidenceEventIds: [input.run.eventId] }; memories.push(memory); if (webSnapshotIds.length > 0) memoryWebEvidence.push({ memoryId: memory.id, snapshotIds: webSnapshotIds }); }
    return { memories, memoryWebEvidence };
  }

  #validateTools(input: AgentCoreInput, executions: readonly ToolExecutionRecord[]): readonly ToolExecutionRecord[] {
    const allowed = new Set(input.availableTools.map(({ name }) => name));
    for (const execution of executions) if (execution.runId !== input.run.runId || execution.eventId !== input.run.eventId || !allowed.has(execution.name)) throw new DomainError("VALIDATION", "Tool execution does not belong to this run or is not allowed");
    return executions;
  }
}
