import { z } from "zod";

import { DomainError } from "../domain/contracts.js";
import type { ToolResult } from "./ports.js";

export type ToolExecutionContext = {
  readonly agentId: string;
  readonly runId: string;
  readonly idempotencyKey: string;
  readonly transport?: { readonly hop: number; readonly expiresAt: string; readonly replyTo?: string };
};
export type RegisteredTool<T = unknown> = { readonly name: string; readonly description: string; readonly schema: z.ZodType<T>; execute(input: T, context: ToolExecutionContext, signal: AbortSignal): Promise<ToolResult> };

export class ToolRegistry {
  readonly #tools = new Map<string, RegisteredTool>();
  readonly #executions = new Map<string, { readonly input: string; readonly result: Promise<ToolResult> }>();
  constructor(tools: readonly RegisteredTool[]) {
    for (const tool of tools) { if (this.#tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`); this.#tools.set(tool.name, tool); }
  }
  definitions(): readonly { name: string; description: string; inputSchema: Record<string, unknown> }[] { return [...this.#tools.values()].map(({ name, description, schema }) => ({ name, description, inputSchema: z.toJSONSchema(schema) })); }
  registered(): readonly RegisteredTool[] { return [...this.#tools.values()]; }
  async execute(name: string, input: unknown, context: ToolExecutionContext, signal: AbortSignal): Promise<ToolResult> {
    const tool = this.#tools.get(name);
    if (tool === undefined) throw new DomainError("NOT_FOUND", `Unknown tool: ${name}`);
    const parsed = tool.schema.safeParse(input);
    if (!parsed.success) throw new DomainError("VALIDATION", `Invalid input for tool: ${name}`, { cause: parsed.error });
    const executionKey = `${name}:${context.idempotencyKey}`;
    const serializedInput = JSON.stringify(parsed.data);
    const existing = this.#executions.get(executionKey);
    if (existing !== undefined) {
      if (existing.input !== serializedInput) throw new DomainError("CONFLICT", `Tool idempotency key was reused with different input: ${name}`);
      return existing.result;
    }
    const result = tool.execute(parsed.data, context, signal);
    this.#executions.set(executionKey, { input: serializedInput, result });
    return result;
  }
}
