import { createMiddleware, ToolMessage } from "langchain";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { DomainError } from "../../domain/contracts.js";
import { errorLogContext, type Logger } from "../../observability/logger.js";
import { DeepAgentToolRunContextSchema, filterModelToolsAfterLimits } from "./deep-agent-tools.js";
import { serializeMessageContent, summarizeModelResponse, toolName } from "./model-response.js";

export function createAgentCoreMiddleware(registry: ToolRegistry | undefined, baseLogger: Logger, now: () => Date): ReturnType<typeof createMiddleware> {
  const registeredToolNames = new Set(registry?.registered().map(({ name }) => name) ?? []);
  const builtInToolNames = new Set(["read_file"]);
  const operationalToolNames = new Set([...registeredToolNames, ...builtInToolNames]);
  const contentReadToolNames = new Set(registry?.registered().filter(({ name }) => registry.resultPolicy(name)?.kind === "content-read").map(({ name }) => name) ?? []);
  return createMiddleware({
    name: "AgentCoreRuntimeMiddleware",
    contextSchema: DeepAgentToolRunContextSchema,
    beforeAgent: (_state, runtime) => {
      const context = DeepAgentToolRunContextSchema.parse(runtime.context);
      baseLogger.child({ agentId: context.agentId, eventId: context.eventId, runId: context.runId }).log("info", "agent_core.deep_agent_started");
    },
    wrapModelCall: async (request, handler) => {
      const context = DeepAgentToolRunContextSchema.parse(request.runtime.context);
      context.collector.modelCallCount += 1;
      const modelCall = context.collector.modelCallCount;
      const logger = baseLogger.child({ agentId: context.agentId, eventId: context.eventId, runId: context.runId, modelCall });
      const systemPrompt = serializeMessageContent(request.systemMessage.content);
      const messages = request.messages.map((message) => ({ role: message.type, content: message.content }));
      const serializedMessages = JSON.stringify(messages);
      if (modelCall > context.maxModelCalls) throw new DomainError("VALIDATION", "Final structured output could not be produced within the model call limit");
      const toolLimitReached = context.collector.count >= context.maxToolCalls;
      const finalizing = context.collector.structuredOutputFailed || toolLimitReached || modelCall === context.maxModelCalls;
      const finalizingReason = context.collector.structuredOutputFailed ? "structured-output-repair" : toolLimitReached ? "tool-call-limit" : modelCall === context.maxModelCalls ? "model-call-budget" : undefined;
      const phaseTools = request.tools.filter((candidate) => {
        const name = toolName(candidate);
        if (name === undefined || !registeredToolNames.has(name)) return true;
        if (context.eventKind === "user-message" && ["concern_list", "concern_get", "self_get"].includes(name)) return false;
        if (context.collector.focusConcernAcquired && ["concern_list", "concern_get"].includes(name)) return false;
        return true;
      });
      const effectiveTools = finalizing ? [] : filterModelToolsAfterLimits(phaseTools, operationalToolNames, contentReadToolNames, false, context.collector.contentReadLimitReached);
      const effectiveRequest = effectiveTools.length === request.tools.length ? request : { ...request, tools: effectiveTools };
      const toolNames = effectiveTools.map((candidate) => toolName(candidate) ?? "unknown");
      const startedAt = now();
      logger.log("info", "agent_core.model_call_started", {
        inputCharacters: systemPrompt.length + serializedMessages.length,
        estimatedInputTokens: Math.ceil((systemPrompt.length + serializedMessages.length) / 4),
        messageCount: messages.length,
        toolCount: toolNames.length, finalizing, finalizingReason
      });
      logger.log("debug", "agent_core.model_call_prompt", { systemPrompt, messages: serializedMessages, toolNames: JSON.stringify(toolNames) });
      try {
        const response = await handler(effectiveRequest);
        if ("goto" in response) context.collector.structuredOutputFailed = true;
        const summary = summarizeModelResponse(response);
        logger.log("info", "agent_core.model_call_completed", { elapsedMs: now().getTime() - startedAt.getTime(), ...summary });
        if (summary.outputCharacters === 0 && summary.toolCallCount === 0) logger.log("warn", "agent_core.model_call_empty", { finishReason: summary.finishReason, ...(summary.inputTokens === undefined ? {} : { inputTokens: summary.inputTokens }), ...(summary.outputTokens === undefined ? {} : { outputTokens: summary.outputTokens }) });
        return response;
      } catch (error) {
        logger.log("error", "agent_core.model_call_failed", { ...errorLogContext(error), elapsedMs: now().getTime() - startedAt.getTime(), aborted: context.signal.aborted });
        throw error;
      }
    },
    wrapToolCall: async (request, handler) => {
      const context = DeepAgentToolRunContextSchema.parse(request.runtime.context);
      if (registeredToolNames.has(request.toolCall.name)) return handler(request);
      if (!builtInToolNames.has(request.toolCall.name)) {
        context.collector.count += 1;
        const callId = `tool-${String(context.collector.count)}`;
        const occurredAt = now().toISOString();
        const error = `Unknown tool: ${request.toolCall.name}`;
        context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name: request.toolCall.name, input: request.toolCall.args, ok: false, error, startedAt: occurredAt, finishedAt: occurredAt });
        baseLogger.child({ agentId: context.agentId, eventId: context.eventId, runId: context.runId, toolCallId: callId, toolName: request.toolCall.name }).log("warn", "tool.completed", { ok: false, errorCode: "UNKNOWN_TOOL" });
        return new ToolMessage({ content: JSON.stringify({ ok: false, errorCode: "UNKNOWN_TOOL", error, requiredNextStep: "Use only a currently available Tool, or return the final Action." }), tool_call_id: request.toolCall.id ?? callId, name: request.toolCall.name, status: "error" });
      }
      context.collector.count += 1;
      const callId = `tool-${String(context.collector.count)}`;
      const startedAt = now().toISOString();
      const input = request.toolCall.args as Record<string, unknown>;
      if (context.signal.aborted) {
        const finishedAt = now().toISOString(); context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name: request.toolCall.name, input, ok: false, error: "Tool execution aborted", startedAt, finishedAt });
        throw new DomainError("ABORTED", "Tool execution aborted");
      }
      if (context.collector.count > context.maxToolCalls) {
        const finishedAt = now().toISOString(); context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name: request.toolCall.name, input, ok: false, error: "Tool call limit exceeded", startedAt, finishedAt });
        throw new DomainError("VALIDATION", "Tool call limit exceeded");
      }
      try {
        const result = await handler(request); const finishedAt = now().toISOString();
        context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name: request.toolCall.name, input, ok: true, result: "Deep Agent built-in Tool completed", startedAt, finishedAt });
        return result;
      } catch (error) {
        const finishedAt = now().toISOString(); const message = error instanceof Error ? error.message : "Tool failed";
        context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name: request.toolCall.name, input, ok: false, error: message, startedAt, finishedAt });
        throw error;
      }
    },
    afterAgent: (_state, runtime) => {
      const context = DeepAgentToolRunContextSchema.parse(runtime.context);
      baseLogger.child({ agentId: context.agentId, eventId: context.eventId, runId: context.runId }).log("info", "agent_core.deep_agent_completed", { modelCallCount: context.collector.modelCallCount, toolExecutionCount: context.collector.executions.length });
    }
  });
}
