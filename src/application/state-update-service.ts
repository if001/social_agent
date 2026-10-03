import { z } from "zod";

import { DomainError, StateUpdateProposalSchema, type DynamicState, type SocialContext } from "../domain/contracts.js";

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
const SocialContextValue = z.object({ subjectId: z.string().min(1), description: z.string().min(1).optional() });

export class StateUpdateService {
  apply(agentId: string, state: DynamicState, proposals: readonly unknown[], socialContexts: readonly SocialContext[] = []): StateUpdateResult {
    if (state.agentId !== agentId) throw new DomainError("VALIDATION", "Cannot update another agent's state");
    const next: Record<string, unknown> = { ...state };
    const changes: StateChange[] = [];
    for (const raw of proposals) {
      const proposal = StateUpdateProposalSchema.parse(raw);
      if (proposal.target === "socialContext") {
        const value = SocialContextValue.parse(proposal.value);
        if (proposal.operation !== "remove" && value.description === undefined) throw new DomainError("VALIDATION", "Social Context set/append requires a description");
        const before = socialContexts.find(({ subjectId }) => subjectId === value.subjectId);
        changes.push({ target: proposal.target, operation: proposal.operation, before, after: proposal.operation === "remove" ? { subjectId: value.subjectId } : value, reason: proposal.reason, evidenceIds: proposal.evidenceIds });
        continue;
      }
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
