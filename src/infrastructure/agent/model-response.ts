export function toolName(candidate: unknown): string | undefined {
  return typeof candidate === "object" && candidate !== null && "name" in candidate && typeof candidate.name === "string" ? candidate.name : undefined;
}

export function serializeMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (content === undefined) return "";
  try {
    const serialized: unknown = JSON.stringify(content);
    return typeof serialized === "string" ? serialized : "";
  } catch { return "[unserializable content]"; }
}

export function summarizeModelResponse(response: unknown): { readonly outputType: string; readonly outputCharacters: number; readonly toolCallCount: number; readonly finishReason: string; readonly toolNames?: string; readonly inputTokens?: number; readonly outputTokens?: number } {
  if (typeof response !== "object" || response === null) return { outputType: typeof response, outputCharacters: 0, toolCallCount: 0, finishReason: "not-reported" };
  // The library returns a structured response or a retry Command after parsing.
  const envelope = response as { messages?: unknown; update?: { messages?: unknown } };
  const wrappedMessages = envelope.messages ?? envelope.update?.messages;
  if (Array.isArray(wrappedMessages)) {
    const ai = wrappedMessages.find((message: unknown) => typeof message === "object" && message !== null && "tool_calls" in message);
    if (ai !== undefined) return summarizeModelResponse(ai);
  }
  const record = response as { readonly content?: unknown; readonly tool_calls?: unknown; readonly response_metadata?: unknown; readonly usage_metadata?: unknown };
  const toolCalls = Array.isArray(record.tool_calls) ? record.tool_calls : [];
  const metadata = typeof record.response_metadata === "object" && record.response_metadata !== null ? record.response_metadata as Record<string, unknown> : {};
  const reportedReason = metadata.finish_reason ?? metadata.done_reason ?? metadata.stop_reason;
  const usage = typeof record.usage_metadata === "object" && record.usage_metadata !== null ? record.usage_metadata as Record<string, unknown> : {};
  const inputTokens = usage.input_tokens ?? metadata.prompt_eval_count; const outputTokens = usage.output_tokens ?? metadata.eval_count;
  return {
    outputType: toolCalls.length > 0 ? "tool-calls" : typeof record.content === "string" ? "text" : Array.isArray(record.content) ? "content-blocks" : "message",
    outputCharacters: serializeMessageContent(record.content).length,
    toolCallCount: toolCalls.length,
    ...(toolCalls.length === 0 ? {} : { toolNames: JSON.stringify(toolCalls.map((call: unknown) => toolName(call) ?? "unknown")) }),
    finishReason: typeof reportedReason === "string" ? reportedReason : metadata.done === true ? "done" : "not-reported",
    ...(typeof inputTokens === "number" ? { inputTokens } : {}), ...(typeof outputTokens === "number" ? { outputTokens } : {})
  };
}

