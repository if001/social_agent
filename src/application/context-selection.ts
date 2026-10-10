import type { Memory, Observation, SocialContext } from "../domain/contracts.js";

export type ContextSelectionReason = "observation-subject" | "memory-link" | "recent-fallback";
export type SelectedContext<T> = { readonly value: T; readonly reason: ContextSelectionReason; readonly required: boolean };

const MAX_SELECTED = 6;
const MAX_FALLBACK = 2;
const compareRecent = <T extends { readonly updatedAt: string; readonly id: string }>(a: T, b: T): number => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id);

export function explicitSubjectIds(observation: Observation): readonly string[] {
  const ids = new Set<string>();
  if (observation.actor !== undefined) ids.add(observation.actor.id);
  const content = typeof observation.content === "object" && observation.content !== null ? observation.content as Record<string, unknown> : {};
  for (const key of ["subjectId", "projectId", "teamId", "organizationId"]) if (typeof content[key] === "string" && content[key].trim() !== "") ids.add(content[key]);
  if (Array.isArray(content.subjectIds)) for (const value of content.subjectIds) if (typeof value === "string" && value.trim() !== "") ids.add(value);
  return [...ids];
}

export function selectSocialContexts(input: { readonly socialContext: readonly SocialContext[]; readonly observation: Observation; readonly memories?: readonly Memory[] }): readonly SelectedContext<SocialContext>[] {
  const explicit = new Set(explicitSubjectIds(input.observation));
  const linked = new Set((input.memories ?? []).flatMap(({ relatedSubjectIds }) => relatedSubjectIds));
  const ranked = input.socialContext.flatMap((value) => {
    const reason: ContextSelectionReason | undefined = explicit.has(value.subjectId) ? "observation-subject" : linked.has(value.subjectId) ? "memory-link" : undefined;
    if (reason === undefined) return [];
    return [{ value, reason, required: reason === "observation-subject", rank: ["observation-subject", "memory-link"].indexOf(reason) }];
  }).sort((a, b) => a.rank - b.rank || compareRecent(a.value, b.value));
  const chosen = ranked.slice(0, MAX_SELECTED).map(({ value, reason, required }) => ({ value, reason, required }));
  const chosenIds = new Set(chosen.map(({ value }) => value.id));
  const fallback = input.socialContext.filter(({ id }) => !chosenIds.has(id)).sort(compareRecent).slice(0, Math.min(MAX_FALLBACK, MAX_SELECTED - chosen.length)).map((value): SelectedContext<SocialContext> => ({ value, reason: "recent-fallback", required: false }));
  return [...chosen, ...fallback];
}

export const contextSelectionLimits = { maxSelected: MAX_SELECTED, maxFallback: MAX_FALLBACK } as const;
