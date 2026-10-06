import type { Clock, IdGenerator, MessageQueue } from "./ports.js";
import type { AgentAction, DomainEvent } from "../domain/contracts.js";
import type { ProcessLifecycle } from "../bootstrap/lifecycle.js";
import { errorLogContext, noopLogger, type Logger } from "../observability/logger.js";

export type ScheduledTarget = { readonly id: string; readonly agentId: string; readonly kind: "intention" | "persistent-drive" | "state-review" | "memory-recall" | "autonomy-review" | "long-term-review"; readonly reason: string; readonly candidateIds?: readonly string[] };
export interface ScheduleRepository {
  claimDue(now: Date, limit: number): Promise<readonly ScheduledTarget[]>;
  complete(target: ScheduledTarget, nextReviewAt: Date | null): Promise<void>;
  release(target: ScheduledTarget): Promise<void>;
}
export interface InternalEventRuntime { process(event: DomainEvent, signal: AbortSignal): Promise<AgentAction>; }
export type SchedulerOptions = { readonly repository: ScheduleRepository; readonly runtime: InternalEventRuntime; readonly queue: MessageQueue; readonly clock: Clock; readonly ids: IdGenerator; readonly lifecycle: ProcessLifecycle; readonly defaultDestination: (agentId: string) => string | undefined; readonly reviewIntervalMs: number; readonly logger?: Logger; readonly memoryRecallIntervalMs?: number; readonly batchSize?: number };

export class Scheduler {
  readonly #running = new Set<string>();
  constructor(private readonly options: SchedulerOptions) {}
  #canRun(signal: AbortSignal): boolean { return this.options.lifecycle.accepting && !signal.aborted; }
  async tick(signal: AbortSignal): Promise<number> {
    if (!this.#canRun(signal)) return 0;
    const targets = await this.options.repository.claimDue(this.options.clock.now(), this.options.batchSize ?? 100);
    if (targets.length > 0) (this.options.logger ?? noopLogger).log("info", "scheduler.targets_claimed", { targetCount: targets.length });
    let completed = 0;
    for (const target of targets) {
      const targetKey = `${target.kind}:${target.id}`;
      if (this.#running.has(targetKey) || !this.#canRun(signal)) { await this.options.repository.release(target); continue; }
      this.#running.add(targetKey);
      const logger = (this.options.logger ?? noopLogger).child({ agentId: target.agentId, scheduleId: target.id, scheduleKind: target.kind });
      try {
        logger.log("info", "scheduler.target_started");
        const occurredAt = this.options.clock.now();
        const event: DomainEvent = { id: this.options.ids.next(), agentId: target.agentId, kind: "internal", occurredAt: occurredAt.toISOString(), payload: { targetId: target.id, targetKind: target.kind, reason: target.reason, schedulerGenerated: true, ...(target.candidateIds === undefined ? {} : { candidateIds: target.candidateIds }) } };
        const action = await this.options.runtime.process(event, signal);
        if (action.type === "respond") {
          const now = this.options.clock.now();
          const destination = this.options.defaultDestination(target.agentId);
          if (destination !== undefined && destination.trim() !== "") await this.options.queue.publish({ id: this.options.ids.next(), destination, source: target.agentId, sentAt: now.toISOString(), availableAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), attempt: 0, hop: 0, payload: { type: "agent-response", text: action.content, agentId: target.agentId, autonomous: true } });
        }
        const autonomous = target.kind === "persistent-drive" || target.kind === "state-review" || target.kind === "memory-recall" || target.kind === "autonomy-review";
        const next = action.type === "wait" && action.until !== undefined ? new Date(action.until) : target.kind === "memory-recall" ? new Date(occurredAt.getTime() + (this.options.memoryRecallIntervalMs ?? 604_800_000)) : autonomous ? new Date(occurredAt.getTime() + this.options.reviewIntervalMs) : action.type === "no-action" ? null : new Date(occurredAt.getTime() + this.options.reviewIntervalMs);
        await this.options.repository.complete(target, next);
        logger.log("info", "scheduler.target_completed", { actionType: action.type, nextReviewAt: next?.toISOString() });
        completed += 1;
      } catch (error) {
        await this.options.repository.release(target);
        logger.log("error", "scheduler.target_failed", errorLogContext(error));
        throw error;
      } finally { this.#running.delete(targetKey); }
    }
    return completed;
  }
}
