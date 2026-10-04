import type { Clock, IdGenerator, MessageQueue } from "./ports.js";

export class RuntimeEventPublisher {
  constructor(private readonly queue: MessageQueue, private readonly clock: Clock, private readonly ids: IdGenerator, private readonly source = "runtime-event-publisher") {}

  publishExternal(agentId: string, input: { readonly text: string; readonly sourceId: string; readonly facts?: readonly string[]; readonly actorId?: string; readonly content?: unknown }): Promise<string> {
    return this.#publish(agentId, { type: "external-event", text: input.text, sourceId: input.sourceId, facts: [...(input.facts ?? [])], ...(input.actorId === undefined ? {} : { actorId: input.actorId }), ...(input.content === undefined ? {} : { content: input.content }) });
  }
  publishTime(agentId: string, reason: string, scheduledFor = this.clock.now()): Promise<string> { return this.#publish(agentId, { type: "time-event", reason, scheduledFor: scheduledFor.toISOString() }); }
  publishSystem(agentId: string, reason: string, change?: Readonly<Record<string, unknown>>): Promise<string> { return this.#publish(agentId, { type: "system-event", reason, ...(change === undefined ? {} : { change }) }); }

  async #publish(agentId: string, payload: Record<string, unknown>): Promise<string> {
    const now = this.clock.now(); const id = this.ids.next();
    await this.queue.publish({ id, destination: agentId, source: this.source, sentAt: now.toISOString(), availableAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), attempt: 0, hop: 0, payload });
    return id;
  }
}
