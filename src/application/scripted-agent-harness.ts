import type { AgentHarness } from "./ports.js";
import type { AgentCoreInput, AgentCoreOutput } from "../domain/contracts.js";

export type ScriptedStep = AgentCoreOutput | Error | ((input: AgentCoreInput) => AgentCoreOutput | Promise<AgentCoreOutput>);

export class ScriptedAgentHarness implements AgentHarness {
  #index = 0;
  constructor(private readonly steps: readonly ScriptedStep[]) {}
  async run(input: AgentCoreInput, signal: AbortSignal): Promise<AgentCoreOutput> {
    if (signal.aborted) throw signal.reason;
    const step = this.steps[this.#index++];
    if (step === undefined) throw new Error("Scripted harness exhausted");
    if (step instanceof Error) throw step;
    return typeof step === "function" ? step(input) : step;
  }
}
