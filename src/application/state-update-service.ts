import { z } from "zod";

import { DomainError, MotiveProposalSchema, StateUpdateProposalSchema, type DynamicState, type Motive, type MotiveExploration, type MotiveProposal, type SocialContext } from "../domain/contracts.js";

export type StateChange = {
  readonly target: string;
  readonly operation: "set" | "append" | "remove";
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string;
  readonly evidenceIds: readonly string[];
};

export type StateUpdateResult = { readonly state: DynamicState; readonly changes: readonly StateChange[] };

export function applyMotiveProposals(state: DynamicState, rawProposals: readonly unknown[], nextId: () => string, occurredAt = state.updatedAt): StateUpdateResult {
  let motives = [...state.motives];
  let motiveExploration = [...state.motiveExploration];
  const changes: StateChange[] = [];
  const metadata = (motiveId: string): MotiveExploration => motiveExploration.find((item) => item.motiveId === motiveId) ?? { motiveId, consecutiveNoProgress: 0 };
  const materialize = (proposal: Extract<MotiveProposal, { operation: "create" }>, id: string): Motive => ({ id, description: proposal.description, ...(proposal.goal === undefined ? {} : { goal: proposal.goal, progress: proposal.progress ?? 0 }), sourceEvidenceIds: [...new Set(proposal.evidenceIds)], since: occurredAt });
  for (const raw of rawProposals) {
    const proposal = MotiveProposalSchema.parse(raw);
    const before = [...motives];
    if (proposal.operation === "create") {
      const motive = materialize(proposal, nextId()); motives.push(motive); motiveExploration.push({ motiveId: motive.id, consecutiveNoProgress: 0 });
      changes.push({ target: "motives", operation: "append", before, after: motives, reason: proposal.reason, evidenceIds: proposal.evidenceIds }); continue;
    }
    if (proposal.operation === "merge") {
      const sources = proposal.motiveIds.map((id) => motives.find((item) => item.id === id));
      if (sources.some((item) => item === undefined)) throw new DomainError("VALIDATION", "Cannot merge an unknown Motive");
      const known = sources.filter((item): item is Motive => item !== undefined); const id = nextId();
      motives = motives.filter((item) => !proposal.motiveIds.includes(item.id));
      motives.push({ id, description: proposal.description, ...(proposal.goal === undefined ? {} : { goal: proposal.goal, progress: proposal.progress ?? 0 }), sourceEvidenceIds: [...new Set([...known.flatMap(({ sourceEvidenceIds }) => sourceEvidenceIds), ...proposal.evidenceIds])], since: known.map(({ since }) => since).sort()[0] ?? occurredAt });
      motiveExploration = [...motiveExploration.filter((item) => !proposal.motiveIds.includes(item.motiveId)), { motiveId: id, consecutiveNoProgress: 0 }];
      changes.push({ target: "motives", operation: "set", before, after: motives, reason: proposal.reason, evidenceIds: proposal.evidenceIds }); continue;
    }
    const index = motives.findIndex(({ id }) => id === proposal.motiveId); const existing = motives[index];
    if (existing === undefined) throw new DomainError("VALIDATION", "Cannot update an unknown Motive");
    if (proposal.operation === "resolve" || proposal.operation === "drop") { motives.splice(index, 1); motiveExploration = motiveExploration.filter(({ motiveId }) => motiveId !== proposal.motiveId); changes.push({ target: "motives", operation: "remove", before, after: motives, reason: proposal.reason, evidenceIds: proposal.evidenceIds }); continue; }
    if (proposal.operation === "maintain") { changes.push({ target: "motives", operation: "set", before, after: motives, reason: proposal.reason, evidenceIds: proposal.evidenceIds }); continue; }
    if (!("description" in proposal)) throw new DomainError("VALIDATION", "Unsupported Motive operation");
    const update: Extract<MotiveProposal, { operation: "update" }> = proposal;
    const previous = metadata(update.motiveId); const nextProgress = update.goal === undefined ? undefined : update.progress ?? 0;
    const progressed = nextProgress !== undefined && (existing.progress === undefined || nextProgress > existing.progress);
    motives[index] = { ...existing, description: update.description, ...(update.goal === undefined ? { goal: undefined, progress: undefined } : { goal: update.goal, progress: nextProgress }), sourceEvidenceIds: [...new Set([...existing.sourceEvidenceIds, ...update.evidenceIds])] };
    const noProgress = progressed ? 0 : previous.consecutiveNoProgress + 1; const cooldownUntil = noProgress >= 2 ? new Date(new Date(occurredAt).getTime() + 21_600_000).toISOString() : undefined;
    motiveExploration = [...motiveExploration.filter(({ motiveId }) => motiveId !== proposal.motiveId), { motiveId: proposal.motiveId, consecutiveNoProgress: noProgress, lastExploredAt: occurredAt, ...(cooldownUntil === undefined ? {} : { cooldownUntil }) }];
    changes.push({ target: "motives", operation: "set", before, after: motives, reason: proposal.reason, evidenceIds: proposal.evidenceIds });
  }
  return { state: { ...state, motives, motiveExploration }, changes };
}

const persistentScalarTargets = new Set(["mood"]);
const persistentCollectionTargets = new Set<string>();
const transientScalarTargets = new Set(["emotion"]);
const transientCollectionTargets = new Set<string>();
const SocialContextValue = z.object({ subjectId: z.string().min(1), subjectType: z.enum(["user", "agent", "team", "project", "organization"]).optional(), description: z.string().min(1).optional() });

export class StateUpdateService {
  apply(agentId: string, state: DynamicState, proposals: readonly unknown[], socialContexts: readonly SocialContext[] = []): StateUpdateResult {
    if (state.agentId !== agentId) throw new DomainError("VALIDATION", "Cannot update another agent's state");
    const next: Record<string, unknown> = { ...state };
    const transient: Record<string, unknown> = {};
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
