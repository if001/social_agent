import type { Clock, IdGenerator, MessageQueue } from "../../application/ports.js";
import type { MessageEnvelope } from "../../domain/contracts.js";

export type TerminalMessage = { readonly agentId: string; readonly text: string; readonly correlationId?: string };

export class TerminalAdapter {
  constructor(private readonly queue: MessageQueue, private readonly clock: Clock, private readonly ids: IdGenerator, readonly destination = "terminal") {}
  async send(agentId: string, text: string): Promise<string> {
    const now = this.clock.now(); const id = this.ids.next();
    await this.queue.publish({ id, destination: agentId, source: this.destination, replyTo: this.destination, sentAt: now.toISOString(), availableAt: now.toISOString(), expiresAt: new Date(now.getTime() + 86_400_000).toISOString(), attempt: 0, hop: 0, payload: { type: "user-message", text } });
    return id;
  }
  receive(handler: (message: TerminalMessage) => Promise<void>, signal: AbortSignal): Promise<void> {
    return this.queue.subscribe(this.destination, async (envelope: MessageEnvelope) => {
      const payload = envelope.payload;
      if (payload.type !== "agent-response" || typeof payload.text !== "string" || typeof payload.agentId !== "string") throw new Error("Invalid terminal response");
      await handler({ agentId: payload.agentId, text: payload.text, ...(typeof payload.correlationId === "string" ? { correlationId: payload.correlationId } : {}) });
    }, signal);
  }
}
