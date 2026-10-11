import { createMiddleware, ToolMessage } from "langchain";
import { projectToolResult, type ToolRegistry } from "../../application/tool-registry.js";

function parsedRecord(content: unknown): Record<string, unknown> | undefined {
  if (typeof content !== "string") return undefined;
  try { const value: unknown = JSON.parse(content); return typeof value === "object" && value !== null ? value as Record<string, unknown> : undefined; } catch { return undefined; }
}
function compactToolContent(name: string | undefined, content: unknown, registry?: ToolRegistry): string {
  const envelope = parsedRecord(content);
  const project = (value: unknown): unknown => name === undefined || registry === undefined
    ? projectToolResult(undefined, value, "conversation-history")
    : registry.projectResult(name, value, "conversation-history");
  if (envelope !== undefined && "ok" in envelope) {
    return JSON.stringify(envelope.ok === true ? { ...envelope, value: project(envelope.value) } : project(envelope));
  }
  return JSON.stringify(project(envelope ?? content));
}

export function compactPriorToolMessages(messages: readonly unknown[], registry?: ToolRegistry): readonly unknown[] {
  let trailingStart = messages.length; while (trailingStart > 0 && ToolMessage.isInstance(messages[trailingStart - 1])) trailingStart -= 1;
  return messages.map((message, index) => {
    if (index >= trailingStart || !ToolMessage.isInstance(message)) return message;
    return new ToolMessage({ content: compactToolContent(message.name, message.content, registry), tool_call_id: message.tool_call_id, ...(message.name === undefined ? {} : { name: message.name }), ...(message.status === undefined ? {} : { status: message.status }) });
  });
}

export function createToolHistoryCompactionMiddleware(registry?: ToolRegistry): unknown {
  return createMiddleware({ name: "AgentCoreToolHistoryCompactionMiddleware", wrapModelCall: (request, handler) => handler({ ...request, messages: compactPriorToolMessages(request.messages, registry) as typeof request.messages }) });
}

