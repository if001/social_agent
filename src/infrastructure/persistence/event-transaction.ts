import { projectToolResult, type ToolRegistry } from "../../application/tool-registry.js";
import type { Memory, MessageEnvelope, ToolExecutionRecord } from "../../domain/contracts.js";
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
  readonly toolExecutions?: readonly (ToolExecutionRecord & { readonly id: string })[];
  readonly outbox: readonly MessageEnvelope[];
};

export type FailedEventInput = Omit<CommitEventInput, "stateValues" | "changes" | "memories" | "memoryWebEvidence" | "outbox"> & { readonly failureReason: string };

export class PostgresEventTransaction {
  constructor(private readonly unitOfWork: PostgresUnitOfWork, private readonly tools?: ToolRegistry) {}
  async commit(input: CommitEventInput): Promise<"committed" | "duplicate"> {
    return this.unitOfWork.transaction(async (client) => {
      const reserved = await client.query("INSERT INTO message_receipts(destination,message_id,status) VALUES ($1,$2,'processing') ON CONFLICT DO NOTHING RETURNING message_id", [input.destination, input.messageId]);
      if (reserved.rowCount === 0) return "duplicate";
      await client.query("INSERT INTO events(id,agent_id,kind,observation,source,causation_id,correlation_id,status,occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7,'processing',$8)", [input.event.id, input.event.agentId, input.event.kind, input.event.observation, input.event.source, input.event.causationId ?? null, input.event.correlationId ?? null, input.event.occurredAt]);
      await client.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,started_at) VALUES ($1,$2,$3,$4,$5)", [input.run.id, input.event.agentId, input.event.id, input.run.inputStateVersion, input.run.startedAt]);
      const repository = new AgentStateRepository(client);
      await repository.update(input.event.agentId, input.run.inputStateVersion, input.stateValues);
      await this.#syncMotiveSchedules(client, input.event.agentId, input.stateValues.motives);
      for (const change of input.changes) await client.query("INSERT INTO state_changes(id,run_id,target,operation,before,after,reason,evidence_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [change.id, input.run.id, change.target, change.operation, JSON.stringify(change.before), JSON.stringify(change.after), change.reason, JSON.stringify(change.evidenceIds)]);
      for (const change of input.changes.filter(({ target }) => target === "socialContext")) {
        const value = change.after as { readonly subjectId?: string; readonly subjectType?: string; readonly description?: string } | undefined;
        if (value?.subjectId === undefined) throw new Error("Social Context change is missing subjectId");
        if (change.operation === "remove") await client.query("DELETE FROM social_contexts WHERE agent_id=$1 AND subject_id=$2", [input.event.agentId, value.subjectId]);
        else await client.query("INSERT INTO social_contexts(id,agent_id,subject_id,subject_type,description) VALUES ($1,$2,$3,$4,$5) ON CONFLICT (agent_id,subject_id) DO UPDATE SET subject_type=EXCLUDED.subject_type,description=EXCLUDED.description,updated_at=now()", [change.id, input.event.agentId, value.subjectId, value.subjectType, value.description]);
      }
      for (const memory of input.memories ?? []) {
        await client.query("INSERT INTO memories(id,agent_id,kind,content,importance,retrieval_priority,occurred_at,created_at,source_agent_id,evidence_event_ids,embedding_status) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'pending')", [memory.id, memory.agentId, memory.kind, memory.content, memory.importance, memory.retrievalPriority, memory.occurredAt, memory.createdAt, memory.sourceAgentId ?? null, JSON.stringify(memory.evidenceEventIds)]);
        for (const subjectId of memory.relatedSubjectIds) await client.query("INSERT INTO memory_subjects(memory_id,subject_id) VALUES ($1,$2)", [memory.id, subjectId]);
      }
      for (const evidence of input.memoryWebEvidence ?? []) for (const snapshotId of evidence.snapshotIds) await client.query("INSERT INTO memory_web_evidence(memory_id,snapshot_id) SELECT $1,s.id FROM web_snapshots s WHERE s.id=$2 ON CONFLICT DO NOTHING", [evidence.memoryId, snapshotId]);
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
      const raw = execution.ok ? execution.result : execution.error; const projected = !execution.ok || this.tools === undefined ? projectToolResult(undefined, raw ?? null, "observation") : this.tools.projectResult(execution.name, raw ?? null, "observation"); const summary = JSON.stringify(projected) || "null";
      const observation = { eventId: resultEventId, summary: `${execution.name} Tool Result: ${summary}`, facts: [`Tool: ${execution.name}`, execution.ok ? "Tool execution succeeded" : "Tool execution failed"], observedAt: execution.finishedAt, kind: "tool-result", actor: { id: execution.name, type: "tool" }, source: { type: "tool", id: execution.name, direct: false }, content: projected, provenance: { toolCallId: execution.callId, runId: execution.runId }, causationId: input.event.id, ...(input.event.correlationId === undefined ? {} : { correlationId: input.event.correlationId }) };
      await client.query("INSERT INTO events(id,agent_id,kind,observation,source,causation_id,correlation_id,status,occurred_at) VALUES ($1,$2,'tool-result',$3,$4,$5,$6,'completed',$7) ON CONFLICT (id) DO NOTHING", [resultEventId, input.event.agentId, observation, execution.name, input.event.id, input.event.correlationId ?? null, execution.finishedAt]);
      await client.query("INSERT INTO tool_executions(id,run_id,event_id,result_event_id,tool_call_id,tool,input,result,error,started_at,finished_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) ON CONFLICT (run_id,tool_call_id) DO NOTHING", [execution.id, execution.runId, execution.eventId, resultEventId, execution.callId, execution.name, execution.input, execution.result ?? null, execution.error ?? null, execution.startedAt, execution.finishedAt]);
      if (execution.name === "web_page" && execution.ok) await client.query("UPDATE web_snapshots SET tool_result_event_id=$3,updated_at=now() WHERE agent_id=$1 AND source_run_id=$2 AND source_tool_call_id=$4", [input.event.agentId, execution.runId, resultEventId, execution.callId]);
    }
  }

  async #syncMotiveSchedules(client: Parameters<Parameters<PostgresUnitOfWork["transaction"]>[0]>[0], agentId: string, rawMotives: unknown): Promise<void> {
    if (!Array.isArray(rawMotives)) return;
    await client.query("DELETE FROM autonomous_schedules WHERE agent_id=$1 AND kind='concern-due'", [agentId]);
    for (const value of rawMotives) {
      if (typeof value !== "object" || value === null) continue;
      const motive = value as { id?: unknown; nextConsiderAt?: unknown; considerationReason?: unknown };
      if (typeof motive.id !== "string" || typeof motive.nextConsiderAt !== "string" || typeof motive.considerationReason !== "string") continue;
      await client.query("INSERT INTO autonomous_schedules(id,agent_id,kind,reason,next_due_at) VALUES ($1,$2,'concern-due',$3,$4)", [`concern:${motive.id}`, agentId, motive.considerationReason, motive.nextConsiderAt]);
    }
  }
}
