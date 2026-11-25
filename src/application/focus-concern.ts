import type { AgentRunResult, Concern, ToolExecutionRecord } from "../domain/contracts.js";

function concernIdOf(execution: ToolExecutionRecord | undefined): string | undefined {
  if (execution === undefined || !execution.ok || typeof execution.input !== "object" || execution.input === null || !("concernId" in execution.input)) return undefined;
  const value = execution.input.concernId;
  return typeof value === "string" ? value : undefined;
}

/** First successful concern_get is the only Runtime-owned Focus for a Run. */
export function focusConcernId(result: AgentRunResult): string | undefined {
  return concernIdOf(result.toolExecutions.find((execution) => execution.name === "concern_get"));
}

/** A derived parent already has a lifecycle transition in this Event. */
export function derivedConcernSourceIds(result: AgentRunResult): ReadonlySet<string> {
  return new Set((result.concernProposals ?? []).flatMap((proposal) => proposal.operation === "derive" && proposal.sourceConcernId !== undefined ? [proposal.sourceConcernId] : []));
}

export function focusedConcernForIntegration(result: AgentRunResult, concerns: readonly Concern[]): Concern | undefined {
  const id = focusConcernId(result);
  if (id === undefined || derivedConcernSourceIds(result).has(id)) return undefined;
  return concerns.find((concern) => concern.id === id && concern.status === "active");
}

export function focusProgressedByHistory(result: AgentRunResult, concernId: string): boolean {
  return result.toolExecutions.some((execution) => execution.name === "concern_history" && concernIdOf(execution) === concernId);
}
