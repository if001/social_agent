import type { InternalEventRuntime } from "./scheduler.js";
import type { AgentRuntime } from "./agent-runtime.js";
import type { AgentAction, DomainEvent } from "../domain/contracts.js";

export class AgentEventRouter implements InternalEventRuntime {
  readonly #tails = new Map<string, Promise<void>>();
  constructor(private readonly normalRuntime: Pick<AgentRuntime, "process">) {}
  process(event: DomainEvent, signal: AbortSignal): Promise<AgentAction> {
    const previous = this.#tails.get(event.agentId) ?? Promise.resolve();
    const result = previous.then(() => this.normalRuntime.process(event, signal), () => this.normalRuntime.process(event, signal));
    const tail = result.then(() => undefined, () => undefined);
    this.#tails.set(event.agentId, tail);
    void tail.finally(() => { if (this.#tails.get(event.agentId) === tail) this.#tails.delete(event.agentId); });
    return result;
  }
}
