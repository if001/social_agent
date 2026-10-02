import type { Clock, IdGenerator, MessageQueue } from "./ports.js";
import type { AgentAction, DomainEvent } from "../domain/contracts.js";
import type { ProcessLifecycle } from "../bootstrap/lifecycle.js";

export type ScheduledTarget = { readonly id: string; readonly agentId: string; readonly kind: "intention" | "persistent-drive" | "long-term-review"; readonly reason: string };
export interface ScheduleRepository {
  claimDue(now: Date, limit: number): Promise<readonly ScheduledTarget[]>;
  complete(targetId: string, nextReviewAt: Date | null): Promise<void>;
  release(targetId: string): Promise<void>;
}
export interface InternalEventRuntime { process(event: DomainEvent, signal: AbortSignal): Promise<AgentAction>; }
export type SchedulerOptions = { readonly repository: ScheduleRepository; readonly runtime: InternalEventRuntime; readonly queue: MessageQueue; readonly clock: Clock; readonly ids: IdGenerator; readonly lifecycle: ProcessLifecycle; readonly defaultDestination: (agentId: string) => string; readonly reviewIntervalMs: number; readonly batchSize?: number };

export class Scheduler {
  readonly #running = new Set<string>();
  constructor(private readonly options: SchedulerOptions) {}
  #canRun(signal: AbortSignal): boolean { return this.options.lifecycle.accepting && !signal.aborted; }
  async tick(signal: AbortSignal): Promise<number> {
    if (!this.#canRun(signal)) return 0;
    const targets = await this.options.repository.claimDue(this.options.clock.now(), this.options.batchSize ?? 100);
    let completed = 0;
    for (const target of targets) {
      if (this.#running.has(target.id) || !this.#canRun(signal)) { await this.options.repository.release(target.id); continue; }
      this.#running.add(target.id);
      try {
        const occurredAt = this.options.clock.now();
        const event: DomainEvent = { id: this.options.ids.next(), agentId: target.agentId, kind: "internal", occurredAt: occurredAt.toISOString(), payload: { targetId: target.id, targetKind: target.kind, reason: target.reason } };
        const action = await this.options.runtime.process(event, signal);
        if (action.type === "respond") {
          const now = this.options.clock.now();
          await this.options.queue.publish({ id: this.options.ids.next(), destination: this.options.defaultDestination(target.agentId), source: target.agentId, sentAt: now.toISOString(), availableAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), attempt: 0, hop: 0, payload: { type: "agent-response", text: action.content, agentId: target.agentId, autonomous: true } });
        }
        const next = action.type === "wait" && action.until !== undefined ? new Date(action.until) : action.type === "no-action" ? null : new Date(occurredAt.getTime() + this.options.reviewIntervalMs);
        await this.options.repository.complete(target.id, next);
        completed += 1;
      } catch (error) {
        await this.options.repository.release(target.id);
        throw error;
      } finally { this.#running.delete(target.id); }
    }
    return completed;
  }
}
