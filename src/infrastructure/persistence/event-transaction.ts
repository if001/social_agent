import type { Candidate, Intention, Memory, MessageEnvelope, ToolExecutionRecord } from "../../domain/contracts.js";
import type { StateChange } from "../../application/state-update-service.js";
import { AgentStateRepository } from "./postgres.js";
import type { PostgresUnitOfWork } from "./postgres.js";

export type CommitEventInput = {
  readonly destination: string;
  readonly messageId: string;
  readonly event: { readonly id: string; readonly agentId: string; readonly kind: string; readonly observation: unknown; readonly source: string; readonly occurredAt: Date; readonly causationId?: string; readonly correlationId?: string };
  readonly run: { readonly id: string; readonly inputStateVersion: number; readonly startedAt: Date; readonly result: unknown };
  readonly stateValues: Readonly<Record<string, unknown>>;
  readonly changes: readonly (StateChange & { readonly id: string })[];
  readonly memories?: readonly Memory[];
  readonly memoryWebEvidence?: readonly { readonly memoryId: string; readonly snapshotIds: readonly string[] }[];
  readonly intentionCreates?: readonly Intention[];
  readonly intentionUpdates?: readonly Intention[];
  readonly candidates?: readonly Candidate[];
  readonly toolExecutions?: readonly (ToolExecutionRecord & { readonly id: string })[];
  readonly outbox: readonly MessageEnvelope[];
};

export type FailedEventInput = Omit<CommitEventInput, "stateValues" | "changes" | "memories" | "memoryWebEvidence" | "intentionCreates" | "intentionUpdates" | "candidates" | "outbox"> & { readonly failureReason: string };

export class PostgresEventTransaction {
  constructor(private readonly unitOfWork: PostgresUnitOfWork) {}
  async commit(input: CommitEventInput): Promise<"committed" | "duplicate"> {
    return this.unitOfWork.transaction(async (client) => {
      const reserved = await client.query("INSERT INTO message_receipts(destination,message_id,status) VALUES ($1,$2,'processing') ON CONFLICT DO NOTHING RETURNING message_id", [input.destination, input.messageId]);
      if (reserved.rowCount === 0) return "duplicate";
      await client.query("INSERT INTO events(id,agent_id,kind,observation,source,causation_id,correlation_id,status,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'processing',$8)", [input.event.id, input.event.agentId, input.event.kind, input.event.observation, input.event.source, input.event.causationId ?? null, input.event.correlationId ?? null, input.event.occurredAt]);
      await client.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,started_at) VALUES ($1,$2,$3,$4,$5)", [input.run.id, input.event.agentId, input.event.id, input.run.inputStateVersion, input.run.startedAt]);
      const repository = new AgentStateRepository(client);
      await repository.update(input.event.agentId, input.run.inputStateVersion, input.stateValues);
      for (const change of input.changes) await client.query("INSERT INTO state_changes(id,run_id,target,operation,before,after,reason,evidence_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [change.id, input.run.id, change.target, change.operation, JSON.stringify(change.before), JSON.stringify(change.after), change.reason, JSON.stringify(change.evidenceIds)]);
      for (const change of input.changes.filter(({ target }) => target === "socialContext")) {
        const value = change.after as { readonly subjectId?: string; readonly subjectType?: string; readonly description?: string } | undefined;
        if (value?.subjectId === undefined) throw new Error("Social Context change is missing subjectId");
        if (change.operation === "remove") await client.query("DELETE FROM social_contexts WHERE agent_id=$1 AND subject_id=$2", [input.event.agentId, value.subjectId]);
        else await client.query("INSERT INTO social_contexts(id,agent_id,subject_id,subject_type,description) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (agent_id,subject_id) DO UPDATE SET subject_type=EXCLUDED.subject_type,description=EXCLUDED.description,updated_at=now()", [change.id, input.event.agentId, value.subjectId, value.subjectType, value.description]);
      }
      for (const memory of input.memories ?? []) {
        await client.query("INSERT INTO memories(id,agent_id,kind,content,importance,retrieval_priority,occurred_at,source_agent_id,evidence_event_ids,embedding_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending')", [memory.id, memory.agentId, memory.kind, memory.content, memory.importance, memory.retrievalPriority, memory.createdAt, memory.sourceAgentId ?? null, JSON.stringify(memory.evidenceEventIds)]);
        for (const subjectId of memory.relatedSubjectIds) await client.query("INSERT INTO memory_subjects(memory_id,subject_id) VALUES ($1,$2)", [memory.id, subjectId]);
        for (const intentionId of memory.relatedIntentionIds) await client.query("INSERT INTO memory_intentions(memory_id,intention_id) VALUES ($1,$2)", [memory.id, intentionId]);
      }
      for (const evidence of input.memoryWebEvidence ?? []) for (const snapshotId of evidence.snapshotIds) await client.query("INSERT INTO memory_web_evidence(memory_id,snapshot_id) SELECT $1,s.id FROM web_snapshots s WHERE s.id=$2 AND s.agent_id=$3 ON CONFLICT DO NOTHING", [evidence.memoryId, snapshotId, input.event.agentId]);
      for (const intention of input.intentionCreates ?? []) await client.query("INSERT INTO intentions(id,agent_id,description,reason,trigger,status,next_review_at,superseded_by_id,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)", [intention.id, intention.agentId, intention.description, intention.reason, intention.trigger === undefined ? null : JSON.stringify(intention.trigger), intention.status, intention.nextReviewAt ?? (intention.trigger?.kind === "time" ? intention.trigger.at : null), intention.supersededById ?? null, intention.createdAt, intention.updatedAt]);
      for (const intention of input.intentionUpdates ?? []) await client.query("UPDATE intentions SET description=$3,reason=$4,status=$5,next_review_at=$6,superseded_by_id=$7,updated_at=$8 WHERE id=$1 AND agent_id=$2", [intention.id, intention.agentId, intention.description, intention.reason, intention.status, intention.nextReviewAt ?? null, intention.supersededById ?? null, intention.updatedAt]);
      for (const candidate of input.candidates ?? []) {
        await client.query("INSERT INTO long_term_candidates(id,agent_id,target,proposed_value,status,reason,evidence_event_ids,review_after,created_at,updated_at) VALUES ($1,$2,$3,$4,$5,$6,$7,CASE WHEN $6 ILIKE '%矛盾%' OR $6 ILIKE '%contradict%' THEN $8::timestamptz ELSE $8::timestamptz+interval '1 day' END,$8,$8)", [candidate.id, candidate.agentId, candidate.target, candidate.proposal, candidate.status, candidate.reason, JSON.stringify(candidate.evidenceEventIds), candidate.createdAt]);
        for (const memoryId of candidate.evidenceMemoryIds) await client.query("INSERT INTO candidate_evidence(candidate_id,memory_id) VALUES ($1,$2)", [candidate.id, memoryId]);
        await client.query("UPDATE long_term_candidates SET review_after=LEAST(review_after,$3::timestamptz) WHERE agent_id=$1 AND target=$2 AND status='pending' AND ((SELECT count(*) FROM long_term_candidates WHERE agent_id=$1 AND target=$2 AND status='pending')>=3 OR EXISTS (SELECT 1 FROM candidate_evidence ce JOIN memories m ON m.id=ce.memory_id WHERE ce.candidate_id=$4 AND (m.retrieval_priority='critical' OR m.kind='self-related' AND m.importance ILIKE '%strong%')))", [candidate.agentId, candidate.target, candidate.createdAt, candidate.id]);
      }
      if (Array.isArray(input.stateValues.drives)) {
        const drives = [...new Set(input.stateValues.drives.filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => value.trim()))];
        const scheduleIds = drives.map((drive) => `drive:${input.event.agentId}:${drive}`);
        await client.query("DELETE FROM autonomous_schedules WHERE agent_id=$1 AND kind='persistent-drive' AND NOT (id=ANY($2::text[]))", [input.event.agentId, scheduleIds]);
        for (const [index, drive] of drives.entries()) await client.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ($1,$2,'persistent-drive',$3,now()) ON CONFLICT (id) DO UPDATE SET reason=EXCLUDED.reason", [scheduleIds[index], input.event.agentId, drive]);
      }
      await this.#insertToolExecutions(client, input, input.toolExecutions ?? []);
      for (const envelope of input.outbox) await client.query("INSERT INTO outbox_messages(id,agent_id,envelope) VALUES ($1,$2,$3)", [envelope.id, input.event.agentId, JSON.stringify(envelope)]);
      await client.query("UPDATE agent_runs SET result=$2,finished_at=now() WHERE id=$1", [input.run.id, input.run.result]);
      await client.query("UPDATE events SET status='completed' WHERE id=$1", [input.event.id]);
      await client.query("UPDATE message_receipts SET status='completed',processed_at=now() WHERE destination=$1 AND message_id=$2", [input.destination, input.messageId]);
      return "committed";
    });
  }

  async recordFailure(input: FailedEventInput): Promise<void> {
    await this.unitOfWork.transaction(async (client) => {
      await client.query("INSERT INTO events(id,agent_id,kind,observation,source,causation_id,correlation_id,status,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'failed',$8) ON CONFLICT (id) DO NOTHING", [input.event.id, input.event.agentId, input.event.kind, input.event.observation, input.event.source, input.event.causationId ?? null, input.event.correlationId ?? null, input.event.occurredAt]);
      await client.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,result,failure_reason,started_at,finished_at) VALUES ($1,$2,$3,$4,$5,$6,$7,now()) ON CONFLICT (id) DO UPDATE SET failure_reason=EXCLUDED.failure_reason,finished_at=EXCLUDED.finished_at", [input.run.id, input.event.agentId, input.event.id, input.run.inputStateVersion, input.run.result, input.failureReason, input.run.startedAt]);
      await this.#insertToolExecutions(client, input, input.toolExecutions ?? []);
    });
  }

  async #insertToolExecutions(client: Parameters<Parameters<PostgresUnitOfWork["transaction"]>[0]>[0], input: Pick<CommitEventInput, "event" | "run">, executions: readonly (ToolExecutionRecord & { readonly id: string })[]): Promise<void> {
    for (const execution of executions) {
      const resultEventId = `${execution.eventId}:tool-result:${execution.callId}`;
      const raw = execution.ok ? execution.result : execution.error; const summary = JSON.stringify(raw ?? null).slice(0, 4_000) || "null";
      const observation = { eventId: resultEventId, summary: `${execution.name} Tool Result: ${summary}`, facts: [`Tool: ${execution.name}`, execution.ok ? "Tool execution succeeded" : "Tool execution failed"], observedAt: execution.finishedAt, kind: "tool-result", actor: { id: execution.name, type: "tool" }, source: { type: "tool", id: execution.name, direct: false }, content: raw ?? null, provenance: { toolCallId: execution.callId, runId: execution.runId }, causationId: input.event.id, ...(input.event.correlationId === undefined ? {} : { correlationId: input.event.correlationId }) };
      await client.query("INSERT INTO events(id,agent_id,kind,observation,source,causation_id,correlation_id,status,occurred_at) VALUES ($1,$2,'tool-result',$3,$4,$5,$6,'completed',$7) ON CONFLICT (id) DO NOTHING", [resultEventId, input.event.agentId, observation, execution.name, input.event.id, input.event.correlationId ?? null, execution.finishedAt]);
      await client.query("INSERT INTO tool_executions(id,run_id,event_id,result_event_id,tool_call_id,tool,input,result,error,started_at,finished_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (run_id,tool_call_id) DO NOTHING", [execution.id, execution.runId, execution.eventId, resultEventId, execution.callId, execution.name, execution.input, execution.result ?? null, execution.error ?? null, execution.startedAt, execution.finishedAt]);
      if (execution.name === "web_page" && execution.ok) await client.query("UPDATE web_snapshots SET tool_result_event_id=$3,updated_at=now() WHERE agent_id=$1 AND source_run_id=$2 AND source_tool_call_id=$4", [input.event.agentId, execution.runId, resultEventId, execution.callId]);
    }
  }
}
