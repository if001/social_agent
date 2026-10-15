import { toolName } from "./model-response.js";
import { tool, type ToolRuntime } from "langchain";
import { z } from "zod";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { projectToolInput } from "../../application/tool-registry.js";
import { DomainError, type AgentCoreInput, type ToolExecutionRecord } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { modelJsonSchema } from "./model-json-schema.js";

export class ToolExecutionCollector {
  count = 0;
  modelCallCount = 0;
  structuredOutputFailed = false;
  contentReadCharacters = 0;
  contentReadReservedCharacters = 0;
  contentReadLimitReached = false;
  focusConcernAcquired = false;
  readonly executions: ToolExecutionRecord[] = [];
}

export function filterModelToolsAfterLimits<T>(tools: readonly T[], operationalToolNames: ReadonlySet<string>, contentReadToolNames: ReadonlySet<string>, toolLimitReached: boolean, contentReadLimitReached: boolean): T[] {
  if (!toolLimitReached && !contentReadLimitReached) return [...tools];
  return tools.filter((candidate) => {
    const name = toolName(candidate);
    if (name === undefined) return true;
    if (toolLimitReached && operationalToolNames.has(name)) return false;
    return !(contentReadLimitReached && contentReadToolNames.has(name));
  });
}

function contentTextCharacters(value: unknown): number {
  if (Array.isArray(value)) return value.reduce((total: number, item) => total + contentTextCharacters(item), 0);
  if (typeof value !== "object" || value === null) return 0;
  return Object.entries(value).reduce((total, [key, item]) => total + (["content", "text", "markdown", "snippet"].includes(key) && typeof item === "string" ? item.length : contentTextCharacters(item)), 0);
}

export type DeepAgentToolRunContext = {
  readonly agentId: string;
  readonly runId: string;
  readonly eventId: string;
  readonly eventKind?: AgentCoreInput["observation"]["kind"];
  readonly maxModelCalls: number;
  readonly maxToolCalls: number;
  readonly signal: AbortSignal;
  readonly collector: ToolExecutionCollector;
  readonly recentToolInputs: readonly string[];
  readonly transport?: AgentCoreInput["run"]["transport"];
};

export const DeepAgentToolRunContextSchema = z.object({
  agentId: z.string().min(1),
  runId: z.string().min(1),
  eventId: z.string().min(1),
  eventKind: z.enum(["user-message", "tool-result", "time", "external", "internal", "system"]).optional(),
  maxModelCalls: z.number().int().positive(),
  maxToolCalls: z.number().int().nonnegative(),
  signal: z.custom<AbortSignal>((value) => value instanceof AbortSignal),
  collector: z.instanceof(ToolExecutionCollector),
  recentToolInputs: z.array(z.string()).default([]),
  transport: z.object({ hop: z.number().int().nonnegative(), expiresAt: z.string(), replyTo: z.string().optional() }).optional()
});

export function createDeepAgentToolRunContext(options: Omit<DeepAgentToolRunContext, "collector" | "recentToolInputs" | "maxModelCalls"> & { readonly maxModelCalls?: number; readonly recentToolInputs?: readonly string[] }): DeepAgentToolRunContext {
  return { ...options, maxModelCalls: options.maxModelCalls ?? 8, recentToolInputs: options.recentToolInputs ?? [], collector: new ToolExecutionCollector() };
}

export type DeepAgentRunTool = { invoke(input: Record<string, unknown>, config?: unknown): Promise<unknown> };

async function executeDeepAgentTool(registry: ToolRegistry, name: string, rawInput: Record<string, unknown>, context: DeepAgentToolRunContext, now: () => Date, baseLogger: Logger): Promise<string> {
    context.collector.count += 1;
    const callId = `tool-${String(context.collector.count)}`;
    const startedAt = now().toISOString();
    const logger = baseLogger.child({ agentId: context.agentId, eventId: context.eventId, runId: context.runId, toolCallId: callId, toolName: name });
    logger.log("info", "tool.started");
    if (context.signal.aborted) {
      const finishedAt = now().toISOString();
      context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error: "Tool execution aborted", startedAt, finishedAt });
      throw new DomainError("ABORTED", "Tool execution aborted");
    }
    if (context.collector.count > context.maxToolCalls) {
      const finishedAt = now().toISOString();
      const error = "Tool call limit reached. No more Tools can be used for this task.";
      context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error, startedAt, finishedAt });
      logger.log("warn", "tool.completed", { ok: false, errorCode: "TOOL_CALL_LIMIT", elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt) });
      return JSON.stringify({ ok: false, errorCode: "TOOL_CALL_LIMIT_REACHED", error, requiredNextStep: "Use the information already obtained and return the final Action now." });
    }
    const policy = registry.resultPolicy(name);
    const requestedContentCharacters = policy?.kind === "content-read" ? (typeof rawInput.maxCharacters === "number" ? rawInput.maxCharacters : policy.defaultRequestCharacters) : 0;
    if (policy?.kind === "content-read" && context.collector.contentReadReservedCharacters + requestedContentCharacters > policy.runCharacterBudget) {
      context.collector.contentReadLimitReached = true;
      const finishedAt = now().toISOString(); const error = "Content read limit reached. No more content can be read for this task.";
      context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error, startedAt, finishedAt });
      logger.log("warn", "tool.completed", { ok: false, errorCode: "CONTEXT_BUDGET", elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt) });
      return JSON.stringify({ ok: false, errorCode: "CONTENT_READ_LIMIT_REACHED", error, requiredNextStep: "Use the information already obtained and return the final Action now." });
    }
    context.collector.contentReadReservedCharacters += requestedContentCharacters;
    const signature = JSON.stringify({ tool: name, input: projectToolInput(rawInput) });
    const repeatedInRun = context.collector.executions.some((execution) => JSON.stringify({ tool: execution.name, input: projectToolInput(execution.input) }) === signature);
    if (context.recentToolInputs.includes(signature) || repeatedInRun) {
      const finishedAt = now().toISOString();
      const error = "Recent identical Tool input must not be repeated";
      context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error, startedAt, finishedAt });
      logger.log("warn", "tool.completed", { ok: false, errorCode: "REPEATED_INPUT", elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt) });
      return JSON.stringify({ ok: false, error });
    }
    try {
      const transport = context.transport === undefined ? undefined : { hop: context.transport.hop, expiresAt: context.transport.expiresAt, ...(context.transport.replyTo === undefined ? {} : { replyTo: context.transport.replyTo }) };
      const result = await registry.execute(name, rawInput, { agentId: context.agentId, runId: context.runId, eventId: context.eventId, toolCallId: callId, idempotencyKey: `${context.runId}:${callId}`, ...(transport === undefined ? {} : { transport }) }, context.signal);
      const finishedAt = now().toISOString();
      if (result.ok) { if (policy?.kind === "content-read") context.collector.contentReadCharacters += contentTextCharacters(result.value); if (name === "concern_get") context.collector.focusConcernAcquired = true; context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: true, ...(result.value === undefined ? {} : { result: result.value }), startedAt, finishedAt }); }
      else context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error: result.error ?? "Tool failed", startedAt, finishedAt });
      logger.log(result.ok ? "info" : "warn", "tool.completed", { ok: result.ok, elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt) });
      return JSON.stringify(result);
    } catch (error) {
      const finishedAt = now().toISOString();
      const message = error instanceof Error ? error.message : "Tool failed";
      context.collector.executions.push({ callId, runId: context.runId, eventId: context.eventId, name, input: rawInput, ok: false, error: message, startedAt, finishedAt });
      logger.log("error", "tool.failed", { ...errorLogContext(error), elapsedMs: Date.parse(finishedAt) - Date.parse(startedAt) });
      return JSON.stringify({ ok: false, error: message });
    }
}

export function createDeepAgentTools(registry: ToolRegistry, now: () => Date = () => new Date(), baseLogger: Logger = noopLogger): readonly DeepAgentRunTool[] {
  return registry.registered().map((registered) => tool(async (rawInput, runtime: ToolRuntime<unknown, DeepAgentToolRunContext>) => {
    const context = DeepAgentToolRunContextSchema.parse(runtime.context);
    return executeDeepAgentTool(registry, registered.name, rawInput as Record<string, unknown>, context, now, baseLogger);
  }, { name: registered.name, description: registered.description, schema: modelJsonSchema(registered.schema) }));
}
