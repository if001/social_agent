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

const persistentScalarTargets = new Set(["mood"]);
const persistentCollectionTargets = new Set(["drives", "currentInterests"]);
const transientScalarTargets = new Set(["emotion"]);
const transientCollectionTargets = new Set(["desires"]);
const SocialContextValue = z.object({ subjectId: z.string().min(1), subjectType: z.enum(["user", "agent", "team", "project", "organization"]).optional(), description: z.string().min(1).optional() });

export class StateUpdateService {
  apply(agentId: string, state: DynamicState, proposals: readonly unknown[], socialContexts: readonly SocialContext[] = []): StateUpdateResult {
    if (state.agentId !== agentId) throw new DomainError("VALIDATION", "Cannot update another agent's state");
    const next: Record<string, unknown> = { ...state };
    const transient: Record<string, unknown> = { desires: [] as string[] };
    const changes: StateChange[] = [];
    for (const raw of proposals) {
      const proposal = StateUpdateProposalSchema.parse(raw);
      if (proposal.target === "socialContext") {
        const value = SocialContextValue.parse(proposal.value);
        if (proposal.operation !== "remove" && (value.description === undefined || value.subjectType === undefined)) throw new DomainError("VALIDATION", "Social Context set/append requires subjectType and description");
        const before = socialContexts.find(({ subjectId }) => subjectId === value.subjectId);
        changes.push({ target: proposal.target, operation: proposal.operation, before, after: proposal.operation === "remove" ? { subjectId: value.subjectId } : value, reason: proposal.reason, evidenceIds: proposal.evidenceIds });
        continue;
      }
      const scalar = persistentScalarTargets.has(proposal.target) || transientScalarTargets.has(proposal.target);
      const collection = persistentCollectionTargets.has(proposal.target) || transientCollectionTargets.has(proposal.target);
      if (!scalar && !collection) {
        throw new DomainError("VALIDATION", `Target ${proposal.target} requires its owning service`);
      }
      const persistent = persistentScalarTargets.has(proposal.target) || persistentCollectionTargets.has(proposal.target);
      const targetState = persistent ? next : transient;
      const before = targetState[proposal.target];
      if (scalar) {
        if (proposal.operation !== "set" || typeof proposal.value !== "string" || proposal.value.trim() === "") throw new DomainError("VALIDATION", `Invalid operation for ${proposal.target}`);
        targetState[proposal.target] = proposal.value.trim();
      } else {
        const current = Array.isArray(before) ? before.filter((value): value is string => typeof value === "string") : [];
        const values = (Array.isArray(proposal.value) ? proposal.value : [proposal.value]).filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => value.trim());
        if (values.length === 0) throw new DomainError("VALIDATION", `Invalid operation for ${proposal.target}`);
        if (proposal.operation === "set") targetState[proposal.target] = [...new Set(values)];
        if (proposal.operation === "append") targetState[proposal.target] = [...new Set([...current, ...values])];
        if (proposal.operation === "remove") targetState[proposal.target] = current.filter((value) => !values.includes(value));
      }
      changes.push({ target: proposal.target, operation: proposal.operation, before, after: targetState[proposal.target], reason: proposal.reason, evidenceIds: proposal.evidenceIds });
    }
    return { state: next as DynamicState, changes };
  }
}
