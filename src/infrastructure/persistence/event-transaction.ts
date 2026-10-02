import type { MessageEnvelope } from "../../domain/contracts.js";
import type { StateChange } from "../../application/state-update-service.js";
import { AgentStateRepository } from "./postgres.js";
import type { PostgresUnitOfWork } from "./postgres.js";

export type CommitEventInput = {
  readonly destination: string;
  readonly messageId: string;
  readonly event: { readonly id: string; readonly agentId: string; readonly kind: string; readonly observation: unknown; readonly source: string; readonly occurredAt: Date };
  readonly run: { readonly id: string; readonly inputStateVersion: number; readonly startedAt: Date; readonly result: unknown };
  readonly stateValues: Readonly<Record<string, string>>;
  readonly changes: readonly (StateChange & { readonly id: string })[];
  readonly outbox: readonly MessageEnvelope[];
};

export class PostgresEventTransaction {
  constructor(private readonly unitOfWork: PostgresUnitOfWork) {}
  async commit(input: CommitEventInput): Promise<"committed" | "duplicate"> {
    return this.unitOfWork.transaction(async (client) => {
      const reserved = await client.query("INSERT INTO message_receipts(destination,message_id,status) VALUES ($1,$2,'processing') ON CONFLICT DO NOTHING RETURNING message_id", [input.destination, input.messageId]);
      if (reserved.rowCount === 0) return "duplicate";
      await client.query("INSERT INTO events(id,agent_id,kind,observation,source,status,occurred_at) VALUES ($1,$2,$3,$4,$5,'processing',$6)", [input.event.id, input.event.agentId, input.event.kind, input.event.observation, input.event.source, input.event.occurredAt]);
      await client.query("INSERT INTO agent_runs(id,agent_id,event_id,input_state_version,started_at) VALUES ($1,$2,$3,$4,$5)", [input.run.id, input.event.agentId, input.event.id, input.run.inputStateVersion, input.run.startedAt]);
      const repository = new AgentStateRepository(client);
      await repository.update(input.event.agentId, input.run.inputStateVersion, input.stateValues);
      for (const change of input.changes) await client.query("INSERT INTO state_changes(id,run_id,target,operation,before,after,reason,evidence_ids) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [change.id, input.run.id, change.target, change.operation, JSON.stringify(change.before), JSON.stringify(change.after), change.reason, JSON.stringify(change.evidenceIds)]);
      for (const envelope of input.outbox) await client.query("INSERT INTO outbox_messages(id,agent_id,envelope) VALUES ($1,$2,$3)", [envelope.id, input.event.agentId, JSON.stringify(envelope)]);
      await client.query("UPDATE agent_runs SET result=$2,finished_at=now() WHERE id=$1", [input.run.id, input.run.result]);
      await client.query("UPDATE events SET status='completed' WHERE id=$1", [input.event.id]);
      await client.query("UPDATE message_receipts SET status='completed',processed_at=now() WHERE destination=$1 AND message_id=$2", [input.destination, input.messageId]);
      return "committed";
    });
  }
}
