import { z } from "zod";

import { DomainError, DriveProposalSchema, StateUpdateProposalSchema, type DriveProposal, type DynamicState, type SocialContext } from "../domain/contracts.js";

export type StateChange = {
  readonly target: string;
  readonly operation: "set" | "append" | "remove";
  readonly before: unknown;
  readonly after: unknown;
  readonly reason: string;
  readonly evidenceIds: readonly string[];
};

export type StateUpdateResult = { readonly state: DynamicState; readonly changes: readonly StateChange[] };

export function applyDriveProposals(state: DynamicState, rawProposals: readonly unknown[], occurredAt = state.updatedAt): StateUpdateResult {
  let drives = [...state.drives];
  const changes: StateChange[] = [];
  const find = (description: string) => drives.find((drive) => drive.description === description);
  for (const raw of rawProposals) {
    const proposal: DriveProposal = DriveProposalSchema.parse(raw);
    const before = [...drives];
    if (proposal.operation === "create") {
      if (find(proposal.description) === undefined) drives.push({ description: proposal.description, sourceEvidenceIds: [...new Set(proposal.evidenceIds)], since: occurredAt });
      changes.push({ target: "drives", operation: "append", before, after: drives, reason: proposal.reason, evidenceIds: proposal.evidenceIds });
      continue;
    }
    if (proposal.operation === "maintain") {
      if (find(proposal.driveDescription) === undefined) throw new DomainError("VALIDATION", "Cannot maintain an unknown Drive");
      changes.push({ target: "drives", operation: "set", before, after: drives, reason: proposal.reason, evidenceIds: proposal.evidenceIds });
      continue;
    }
    if (proposal.operation === "update") {
      const existing = find(proposal.driveDescription);
      if (existing === undefined) throw new DomainError("VALIDATION", "Cannot update an unknown Drive");
      drives = drives.filter(({ description }) => description !== proposal.driveDescription);
      const duplicate = find(proposal.description);
      if (duplicate === undefined) drives.push({ description: proposal.description, since: existing.since, sourceEvidenceIds: [...new Set([...existing.sourceEvidenceIds, ...proposal.evidenceIds])] });
      changes.push({ target: "drives", operation: "set", before, after: drives, reason: proposal.reason, evidenceIds: proposal.evidenceIds });
      continue;
    }
    if (proposal.operation === "merge") {
      const sources = proposal.driveDescriptions.map(find);
      if (sources.some((drive) => drive === undefined)) throw new DomainError("VALIDATION", "Cannot merge an unknown Drive");
      const known = sources.filter((drive): drive is DynamicState["drives"][number] => drive !== undefined);
      drives = drives.filter(({ description }) => !proposal.driveDescriptions.includes(description));
      const since = known.map(({ since: value }) => value).sort()[0] ?? occurredAt;
      drives.push({ description: proposal.description, since, sourceEvidenceIds: [...new Set([...known.flatMap(({ sourceEvidenceIds }) => sourceEvidenceIds), ...proposal.evidenceIds])] });
      changes.push({ target: "drives", operation: "set", before, after: drives, reason: proposal.reason, evidenceIds: proposal.evidenceIds });
      continue;
    }
    if (find(proposal.driveDescription) === undefined) throw new DomainError("VALIDATION", "Cannot end an unknown Drive");
    drives = drives.filter(({ description }) => description !== proposal.driveDescription);
    changes.push({ target: "drives", operation: "remove", before, after: drives, reason: proposal.reason, evidenceIds: proposal.evidenceIds });
  }
  return { state: { ...state, drives }, changes };
}

const persistentScalarTargets = new Set(["mood"]);
const persistentCollectionTargets = new Set(["currentInterests"]);
const transientScalarTargets = new Set(["emotion"]);
const transientCollectionTargets = new Set(["desires"]);
const SocialContextValue = z.object({ subjectId: z.string().min(1), subjectType: z.enum(["user", "agent", "team", "project", "organization"]).optional(), description: z.string().min(1).optional() });

export class StateUpdateService {
  apply(agentId: string, state: DynamicState, proposals: readonly unknown[], socialContexts: readonly SocialContext[] = [], occurredAt = state.updatedAt): StateUpdateResult {
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
      if (proposal.target === "drives") {
        const before = [...state.drives];
        const descriptions = (Array.isArray(proposal.value) ? proposal.value : [proposal.value]).filter((value): value is string => typeof value === "string" && value.trim() !== "").map((value) => value.trim());
        if (descriptions.length === 0) throw new DomainError("VALIDATION", "Invalid operation for drives");
        const existing = new Map((next.drives as DynamicState["drives"]).map((drive) => [drive.description, drive]));
        const materialize = (description: string) => existing.get(description) ?? { description, sourceEvidenceIds: [...proposal.evidenceIds], since: occurredAt };
        if (proposal.operation === "set") next.drives = [...new Set(descriptions)].map(materialize);
        if (proposal.operation === "append") next.drives = [...existing.values(), ...descriptions.filter((description) => !existing.has(description)).map(materialize)];
        if (proposal.operation === "remove") next.drives = [...existing.values()].filter(({ description }) => !descriptions.includes(description));
        changes.push({ target: proposal.target, operation: proposal.operation, before, after: next.drives, reason: proposal.reason, evidenceIds: proposal.evidenceIds });
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
