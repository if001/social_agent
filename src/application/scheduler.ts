import type { Clock, IdGenerator } from "./ports.js";
import type { AgentAction, DomainEvent } from "../domain/contracts.js";
import type { ProcessLifecycle } from "../bootstrap/lifecycle.js";
import { errorLogContext, noopLogger, type Logger } from "../observability/logger.js";

type ScheduleTargetBase = { readonly id: string; readonly agentId: string; readonly reason: string; readonly instruction?: string; readonly destination?: string };
export type ScheduledTarget = ScheduleTargetBase & (
  | { readonly kind: "idle" }
  | { readonly kind: "concern-due" | "external-change" | "reflection" | "scheduled-task" }
);
export interface ScheduleRepository {
  claimDue(now: Date, limit: number): Promise<readonly ScheduledTarget[]>;
  complete(target: ScheduledTarget, nextReviewAt: Date | null, executionEventId?: string): Promise<void>;
  release(target: ScheduledTarget): Promise<void>;
}
export interface InternalEventRuntime { process(event: DomainEvent, signal: AbortSignal): Promise<AgentAction>; }
export type SchedulerOptions = { readonly repository: ScheduleRepository; readonly runtime: InternalEventRuntime; readonly reflection?: { process(reflectionId: string, agentId: string, signal: AbortSignal): Promise<unknown> }; readonly clock: Clock; readonly ids: IdGenerator; readonly lifecycle: ProcessLifecycle; readonly defaultDestination: (agentId: string) => string | undefined; readonly defaultReplyContext?: (agentId: string) => Readonly<Record<string, unknown>> | undefined; readonly explorationDomains?: readonly string[]; readonly random?: () => number; readonly autonomyReviewIntervalMs: number; readonly stateReviewIntervalMs: number; readonly memoryRecallIntervalMs: number; readonly logger?: Logger; readonly batchSize?: number };

export function randomExplorationCandidates(domains: readonly string[], random: () => number = Math.random, count = 8): readonly string[] {
  const candidates = [...domains];
  for (let index = candidates.length - 1; index > 0; index -= 1) {
    const other = Math.min(index, Math.max(0, Math.floor(random() * (index + 1))));
    [candidates[index], candidates[other]] = [candidates[other] as string, candidates[index] as string];
  }
  return candidates.slice(0, Math.min(count, candidates.length));
}

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
        const destination = target.destination ?? (target.kind === "scheduled-task" ? undefined : this.options.defaultDestination(target.agentId));
        const replyContext = destination === this.options.defaultDestination(target.agentId) ? this.options.defaultReplyContext?.(target.agentId) : undefined;
        const event: DomainEvent = { id: this.options.ids.next(), agentId: target.agentId, kind: target.kind === "scheduled-task" ? "system" : "internal", occurredAt: occurredAt.toISOString(), payload: { targetId: target.id, targetKind: target.kind, reason: target.reason, schedulerGenerated: true, ...(target.kind === "idle" ? { explorationCandidates: randomExplorationCandidates(this.options.explorationDomains ?? [], this.options.random) } : {}), ...(target.instruction === undefined ? {} : { instruction: target.instruction }), ...(destination === undefined || destination.trim() === "" ? {} : { destination }), ...(replyContext === undefined ? {} : { replyContext }) } };
        let action: AgentAction;
        if (target.kind === "reflection") {
          if (this.options.reflection === undefined) throw new Error("Reflection runtime is not configured");
          await this.options.reflection.process(event.id, target.agentId, signal);
          action = { type: "no-external-action", reason: "Reflection maintenance completed" };
        } else action = await this.options.runtime.process(event, signal);
        const interval = target.kind === "idle" ? this.options.autonomyReviewIntervalMs : target.kind === "reflection" ? this.options.stateReviewIntervalMs : target.kind === "concern-due" || target.kind === "external-change" ? null : undefined;
        const next = interval === null ? null : interval === undefined ? action.type === "no-external-action" ? null : new Date(occurredAt.getTime() + this.options.autonomyReviewIntervalMs) : new Date(occurredAt.getTime() + interval);
        await this.options.repository.complete(target, next, event.id);
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
