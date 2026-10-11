import type { AgentHarness } from "./ports.js";
import { AgentCoreOutputSchema, type AgentCoreInput, type AgentCoreOutput, type AgentRunResult } from "../domain/contracts.js";

type LegacyOutput = { readonly interpretation: { readonly activeMotive: { readonly description: string; readonly [key: string]: unknown } }; readonly internalChanges: unknown; readonly action: AgentCoreOutput["action"] };
type ScriptedValue = AgentCoreOutput | LegacyOutput | AgentRunResult;
export type ScriptedStep = ScriptedValue | Error | ((input: AgentCoreInput) => ScriptedValue | Promise<ScriptedValue>);

const isRunResult = (value: ScriptedValue): value is AgentRunResult => "output" in value && "toolExecutions" in value;
const normalize = (value: AgentCoreOutput | LegacyOutput): AgentCoreOutput => AgentCoreOutputSchema.parse("interpretation" in value ? { desire: value.interpretation.activeMotive.description, action: value.action } : value);

export class ScriptedAgentHarness implements AgentHarness {
  #index = 0;
  constructor(private readonly steps: readonly ScriptedStep[]) {}
  async run(input: AgentCoreInput, signal: AbortSignal): Promise<AgentRunResult> {
    if (signal.aborted) throw signal.reason;
    const step = this.steps[this.#index++];
    if (step === undefined) throw new Error("Scripted harness exhausted");
    if (step instanceof Error) throw step;
    const value = await (typeof step === "function" ? step(input) : step);
    return isRunResult(value) ? value : { output: normalize(value), toolExecutions: [] };
  }
}
