import type { AgentHarness } from "./ports.js";
import type { ToolRegistry } from "./tool-registry.js";
import { DomainError, type AgentCoreInput, type AgentCoreOutput } from "../domain/contracts.js";

export type ToolTrace = { readonly callId: string; readonly name: string; readonly result: unknown; readonly ok: boolean };
export class ToolLoop {
  constructor(private readonly harness: AgentHarness, private readonly registry: ToolRegistry) {}
  async run(input: AgentCoreInput, signal: AbortSignal): Promise<{ readonly output: AgentCoreOutput; readonly trace: readonly ToolTrace[] }> {
    let current = input; const trace: ToolTrace[] = [];
    for (let step = 0; step < input.limits.maxSteps; step += 1) {
      const output = await this.harness.run(current, signal);
      if (output.action.type !== "tool") return { output, trace };
      if (trace.length >= input.limits.maxToolCalls) throw new DomainError("VALIDATION", "Tool call limit exceeded");
      let result;
      try { result = await this.registry.execute(output.action.call.name, output.action.call.input, { agentId: input.run.agentId, runId: input.run.runId, idempotencyKey: `${input.run.runId}:${output.action.call.id}` }, signal); }
      catch (error) { result = { ok: false, error: error instanceof Error ? error.message : "Tool failed" }; }
      trace.push({ callId: output.action.call.id, name: output.action.call.name, result: result.value ?? result.error, ok: result.ok });
      current = { ...current, observation: { eventId: input.run.eventId, observedAt: new Date().toISOString(), summary: `Tool ${output.action.call.name} returned`, facts: [JSON.stringify(result)] } };
    }
    throw new DomainError("VALIDATION", "Agent step limit exceeded");
  }
}
