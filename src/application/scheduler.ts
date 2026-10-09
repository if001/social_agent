import type { Clock, IdGenerator, MessageQueue } from "./ports.js";
import { DomainError, type AgentAction, type DomainEvent } from "../domain/contracts.js";
import type { ProcessLifecycle } from "../bootstrap/lifecycle.js";
import { errorLogContext, noopLogger, type Logger } from "../observability/logger.js";

export type ScheduledTarget = { readonly id: string; readonly agentId: string; readonly kind: "intention" | "persistent-drive" | "state-review" | "memory-recall" | "autonomy-review" | "long-term-review"; readonly reason: string; readonly candidateIds?: readonly string[] };
export interface ScheduleRepository {
  claimDue(now: Date, limit: number): Promise<readonly ScheduledTarget[]>;
  complete(target: ScheduledTarget, nextReviewAt: Date | null): Promise<void>;
  release(target: ScheduledTarget): Promise<void>;
}
export interface InternalEventRuntime { process(event: DomainEvent, signal: AbortSignal): Promise<AgentAction>; }
export type SchedulerOptions = { readonly repository: ScheduleRepository; readonly runtime: InternalEventRuntime; readonly queue: MessageQueue; readonly clock: Clock; readonly ids: IdGenerator; readonly lifecycle: ProcessLifecycle; readonly defaultDestination: (agentId: string) => string | undefined; readonly defaultReplyContext?: (agentId: string) => Readonly<Record<string, unknown>> | undefined; readonly autonomyReviewIntervalMs: number; readonly stateReviewIntervalMs: number; readonly memoryRecallIntervalMs: number; readonly intentionReviewIntervalMs?: number; readonly persistentDriveReviewIntervalMs: number; readonly logger?: Logger; readonly batchSize?: number };

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
        if (action.type === "wait") throw new DomainError("VALIDATION", "Autonomous events cannot wait; the Scheduler owns the next execution time");
        if (action.type === "respond") {
          const now = this.options.clock.now();
          const destination = this.options.defaultDestination(target.agentId);
          if (destination !== undefined && destination.trim() !== "") {
            const replyContext = this.options.defaultReplyContext?.(target.agentId);
            await this.options.queue.publish({ id: this.options.ids.next(), destination, source: target.agentId, sentAt: now.toISOString(), availableAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), attempt: 0, hop: 0, payload: { type: "agent-response", text: action.content, agentId: target.agentId, autonomous: true, ...(replyContext === undefined ? {} : { replyContext }) } });
            logger.log("info", "scheduler.response_published", { destination, hasReplyContext: replyContext !== undefined });
          }
        }
        const interval = target.kind === "intention" ? this.options.intentionReviewIntervalMs ?? this.options.autonomyReviewIntervalMs : target.kind === "autonomy-review" ? this.options.autonomyReviewIntervalMs : target.kind === "state-review" ? this.options.stateReviewIntervalMs : target.kind === "memory-recall" ? this.options.memoryRecallIntervalMs : target.kind === "persistent-drive" ? this.options.persistentDriveReviewIntervalMs : undefined;
        const next = interval === undefined ? action.type === "no-external-action" ? null : new Date(occurredAt.getTime() + this.options.autonomyReviewIntervalMs) : new Date(occurredAt.getTime() + interval);
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
