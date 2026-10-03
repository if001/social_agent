import type { AgentHarness } from "./ports.js";
import type { AgentCoreInput, AgentCoreOutput, AgentRunResult } from "../domain/contracts.js";

export type ScriptedStep = AgentCoreOutput | AgentRunResult | Error | ((input: AgentCoreInput) => AgentCoreOutput | AgentRunResult | Promise<AgentCoreOutput | AgentRunResult>);

const isRunResult = (value: AgentCoreOutput | AgentRunResult): value is AgentRunResult => "output" in value && "toolExecutions" in value;

export class ScriptedAgentHarness implements AgentHarness {
  #index = 0;
  constructor(private readonly steps: readonly ScriptedStep[]) {}
  async run(input: AgentCoreInput, signal: AbortSignal): Promise<AgentRunResult> {
    if (signal.aborted) throw signal.reason;
    const step = this.steps[this.#index++];
    if (step === undefined) throw new Error("Scripted harness exhausted");
    if (step instanceof Error) throw step;
    const value = await (typeof step === "function" ? step(input) : step);
    return isRunResult(value) ? value : { output: value, toolExecutions: [] };
  }
}
