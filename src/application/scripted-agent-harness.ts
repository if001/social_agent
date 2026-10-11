import type { AgentHarness } from "./ports.js";
import { AgentCoreOutputSchema, type AgentCoreInput, type AgentCoreOutput, type AgentRunResult } from "../domain/contracts.js";

type ScriptedValue = AgentCoreOutput | AgentRunResult;
export type ScriptedStep = ScriptedValue | Error | ((input: AgentCoreInput) => ScriptedValue | Promise<ScriptedValue>);

const isRunResult = (value: ScriptedValue): value is AgentRunResult => "output" in value && "toolExecutions" in value;

export class ScriptedAgentHarness implements AgentHarness {
  #index = 0;
  constructor(private readonly steps: readonly ScriptedStep[]) {}
  async run(input: AgentCoreInput, signal: AbortSignal): Promise<AgentRunResult> {
    if (signal.aborted) throw signal.reason;
    const step = this.steps[this.#index++];
    if (step === undefined) throw new Error("Scripted harness exhausted");
    if (step instanceof Error) throw step;
    const value = await (typeof step === "function" ? step(input) : step);
    return isRunResult(value) ? value : { output: AgentCoreOutputSchema.parse(value), toolExecutions: [] };
  }
}
