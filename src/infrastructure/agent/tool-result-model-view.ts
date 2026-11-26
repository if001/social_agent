import { projectToolInput, projectToolResult, type ToolRegistry, type ToolResultDestination } from "../../application/tool-registry.js";
import { toModelRecordView } from "./model-record-view.js";

type StoredToolExecution = {
  readonly name: string;
  readonly input: unknown;
  readonly ok: boolean;
  readonly result?: unknown;
  readonly error?: unknown;
};

/**
 * Shared non-immediate Tool view for model inputs after a Tool call has ended.
 * Complete Tool records remain audit data; this applies the same registered
 * result policy used by Agent Core's subsequent model calls.
 */
export function projectToolResultForModel(name: string | undefined, value: unknown, registry: ToolRegistry | undefined, destination: ToolResultDestination = "conversation-history"): unknown {
  const projected = name === undefined || registry === undefined
    ? projectToolResult(undefined, value, destination)
    : registry.projectResult(name, value, destination);
  return toModelRecordView(projected);
}

export function projectToolInputForModel(input: unknown, registry: ToolRegistry | undefined): unknown {
  return toModelRecordView(registry?.projectInput(input) ?? projectToolInput(input));
}

export function projectToolExecutionForModel(execution: StoredToolExecution, registry: ToolRegistry | undefined, destination: ToolResultDestination = "conversation-history"): Record<string, unknown> {
  return {
    name: execution.name,
    input: projectToolInputForModel(execution.input, registry),
    ok: execution.ok,
    ...(execution.ok
      ? { result: projectToolResultForModel(execution.name, execution.result, registry, destination) }
      : { error: projectToolResultForModel(execution.name, { error: execution.error ?? "Tool failed" }, registry, destination) })
  };
}

/** Post-commit integration receives facts, not the lookup and instruction
 * context the Agent Core already used to decide the Event. */
export function projectExperienceEvidenceForModel(executions: readonly StoredToolExecution[], registry: ToolRegistry | undefined): readonly Record<string, unknown>[] {
  if (registry === undefined) return [];
  return executions
    .filter((execution) => execution.ok && registry.isExperienceEvidence(execution.name))
    .slice(0, 6)
    .map((execution) => projectToolExecutionForModel(execution, registry, "recent-experience"));
}
