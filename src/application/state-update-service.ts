import { DomainError, StateUpdateProposalSchema, type DynamicState } from "../domain/contracts.js";

export type StateChange = {
  readonly target: string;
  readonly operation: "set" | "append" | "remove";
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string;
  readonly evidenceIds: readonly string[];
};

export type StateUpdateResult = { readonly state: DynamicState; readonly changes: readonly StateChange[] };

const dynamicTargets = new Set(["emotion", "mood", "drive", "desire"]);

export class StateUpdateService {
  apply(agentId: string, state: DynamicState, proposals: readonly unknown[]): StateUpdateResult {
    if (state.agentId !== agentId) throw new DomainError("VALIDATION", "Cannot update another agent's state");
    const next: Record<string, unknown> = { ...state };
    const changes: StateChange[] = [];
    for (const raw of proposals) {
      const proposal = StateUpdateProposalSchema.parse(raw);
      if (!dynamicTargets.has(proposal.target)) {
        throw new DomainError("VALIDATION", `Target ${proposal.target} requires its owning service`);
      }
      if (proposal.operation !== "set" || typeof proposal.value !== "string" || proposal.value.trim() === "") {
        throw new DomainError("VALIDATION", `Invalid operation for ${proposal.target}`);
      }
      const before = next[proposal.target];
      next[proposal.target] = proposal.value;
      changes.push({ target: proposal.target, operation: proposal.operation, before, after: proposal.value, reason: proposal.reason, evidenceIds: proposal.evidenceIds });
    }
    return { state: next as DynamicState, changes };
  }
}
