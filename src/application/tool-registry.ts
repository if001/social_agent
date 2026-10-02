import type { z } from "zod";

import { DomainError } from "../domain/contracts.js";
import type { ToolResult } from "./ports.js";

export type ToolExecutionContext = { readonly agentId: string; readonly runId: string; readonly idempotencyKey: string };
export type RegisteredTool<T = unknown> = { readonly name: string; readonly description: string; readonly schema: z.ZodType<T>; execute(input: T, context: ToolExecutionContext, signal: AbortSignal): Promise<ToolResult> };

export class ToolRegistry {
  readonly #tools = new Map<string, RegisteredTool>();
  constructor(tools: readonly RegisteredTool[]) {
    for (const tool of tools) { if (this.#tools.has(tool.name)) throw new Error(`Duplicate tool: ${tool.name}`); this.#tools.set(tool.name, tool); }
  }
  definitions(): readonly { name: string; description: string; inputSchema: Record<string, unknown> }[] { return [...this.#tools.values()].map(({ name, description }) => ({ name, description, inputSchema: {} })); }
  async execute(name: string, input: unknown, context: ToolExecutionContext, signal: AbortSignal): Promise<ToolResult> {
    const tool = this.#tools.get(name);
    if (tool === undefined) throw new DomainError("NOT_FOUND", `Unknown tool: ${name}`);
    const parsed = tool.schema.safeParse(input);
    if (!parsed.success) throw new DomainError("VALIDATION", `Invalid input for tool: ${name}`, { cause: parsed.error });
    return tool.execute(parsed.data, context, signal);
  }
}
