import type { LongTermReviewService } from "./long-term-review.js";
import type { InternalEventRuntime } from "./scheduler.js";
import type { AgentRuntime } from "./agent-runtime.js";
import { DomainError, type AgentAction, type DomainEvent } from "../domain/contracts.js";

export class AgentEventRouter implements InternalEventRuntime {
  readonly #tails = new Map<string, Promise<void>>();
  constructor(private readonly normalRuntime: Pick<AgentRuntime, "process">, private readonly review: Pick<LongTermReviewService, "review">) {}
  process(event: DomainEvent, signal: AbortSignal): Promise<AgentAction> {
    const previous = this.#tails.get(event.agentId) ?? Promise.resolve();
    const result = previous.then(() => this.#route(event, signal), () => this.#route(event, signal));
    const tail = result.then(() => undefined, () => undefined);
    this.#tails.set(event.agentId, tail);
    void tail.finally(() => { if (this.#tails.get(event.agentId) === tail) this.#tails.delete(event.agentId); });
    return result;
  }
  async #route(event: DomainEvent, signal: AbortSignal): Promise<AgentAction> {
    if (event.kind !== "internal" || event.payload.targetKind !== "long-term-review") return this.normalRuntime.process(event, signal);
    const candidateIds = Array.isArray(event.payload.candidateIds) ? event.payload.candidateIds.filter((id): id is string => typeof id === "string") : typeof event.payload.targetId === "string" ? [event.payload.targetId] : [];
    if (candidateIds.length === 0) throw new DomainError("VALIDATION", "Long-term Review Event requires Candidate IDs");
    await this.review.review(candidateIds, signal);
    return { type: "no-external-action", reason: "Long-term Review completed" };
  }
}
