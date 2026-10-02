import { createHash } from "node:crypto";
import { z } from "zod";

import type { Clock, MessageQueue } from "../../application/ports.js";
import type { RegisteredTool, ToolExecutionContext } from "../../application/tool-registry.js";
import { DomainError } from "../../domain/contracts.js";

const Input = z.object({ destinationAgentId: z.string().min(1), content: z.string().min(1) });
export type AgentMessageProvenance = { readonly parentHop: number; readonly expiresAt: string; readonly replyTo?: string };
export type AgentSendOptions = { readonly queue: MessageQueue; readonly clock: Clock; readonly maxHops: number; readonly provenance: (context: ToolExecutionContext) => AgentMessageProvenance };

export function createAgentSendTool(options: AgentSendOptions): RegisteredTool<z.infer<typeof Input>> {
  return { name: "agent_send", description: "Send information to another agent", schema: Input, execute: async (input, context) => {
    const provenance = options.provenance(context); const hop = provenance.parentHop + 1; const now = options.clock.now();
    if (hop > options.maxHops) throw new DomainError("VALIDATION", "Agent message hop limit exceeded");
    if (Date.parse(provenance.expiresAt) <= now.getTime()) throw new DomainError("VALIDATION", "Agent message TTL expired");
    const messageId = `agent-${createHash("sha256").update(context.idempotencyKey).digest("hex").slice(0, 24)}`;
    await options.queue.publish({ id: messageId, destination: input.destinationAgentId, source: context.agentId, ...(provenance.replyTo === undefined ? {} : { replyTo: provenance.replyTo }), sentAt: now.toISOString(), availableAt: now.toISOString(), expiresAt: provenance.expiresAt, attempt: 0, hop, payload: { type: "agent-message", senderAgentId: context.agentId, content: input.content, provenance: { runId: context.runId, toolIdempotencyKey: context.idempotencyKey } } });
    return { ok: true, value: { messageId, destinationAgentId: input.destinationAgentId } };
  } };
}
