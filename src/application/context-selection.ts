import type { DynamicState, Intention, Memory, Observation, SocialContext } from "../domain/contracts.js";
import { memoryKeywords } from "./memory-query.js";

export type ContextSelectionReason = "observation-subject" | "scheduled-target" | "trigger-match" | "due" | "memory-link" | "intention-memory-subject" | "current-interest-keyword" | "recent-fallback";
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

function triggerMatches(intention: Intention, observation: Observation): boolean {
  const trigger = intention.trigger;
  if (trigger === undefined) return false;
  const occurredAt = Date.parse(observation.observedAt);
  if (trigger.kind === "time") return Date.parse(trigger.at) <= occurredAt;
  const content = typeof observation.content === "object" && observation.content !== null ? observation.content as Record<string, unknown> : {};
  if (trigger.kind === "manual-review") return content.manualReviewIntentionId === intention.id;
  if (trigger.kind === "idle") return intention.nextReviewAt !== undefined && Date.parse(intention.nextReviewAt) <= occurredAt;
  if (observation.kind === undefined || !trigger.eventKinds.includes(observation.kind)) return false;
  if (trigger.keywords.length === 0) return true;
  const serialized = JSON.stringify(observation).normalize("NFKC").toLocaleLowerCase("ja");
  return trigger.keywords.some((keyword) => serialized.includes(keyword.normalize("NFKC").toLocaleLowerCase("ja")));
}

const directTargetId = (observation: Observation): string | undefined => {
  const content = typeof observation.content === "object" && observation.content !== null ? observation.content as Record<string, unknown> : {};
  return content.targetKind === "intention" && typeof content.targetId === "string" ? content.targetId : undefined;
};

export function requiredIntentionReason(intention: Intention, observation: Observation): ContextSelectionReason | undefined {
  if (intention.id === directTargetId(observation)) return "scheduled-target";
  if (triggerMatches(intention, observation)) return "trigger-match";
  if (intention.nextReviewAt !== undefined && Date.parse(intention.nextReviewAt) <= Date.parse(observation.observedAt)) return "due";
  return undefined;
}

function interestKeywords(state: DynamicState): ReadonlySet<string> {
  return new Set(memoryKeywords(state.currentInterests.flatMap(({ question, goal }) => [question, goal]), 32));
}

function hasKeywordMatch(intention: Intention, keywords: ReadonlySet<string>): boolean {
  if (keywords.size === 0) return false;
  const values = new Set(memoryKeywords([intention.description, intention.reason], 32));
  return [...keywords].some((keyword) => values.has(keyword));
}

export function selectIntentions(input: { readonly intentions: readonly Intention[]; readonly observation: Observation; readonly dynamicState: DynamicState; readonly memories?: readonly Memory[] }): readonly SelectedContext<Intention>[] {
  const linked = new Set((input.memories ?? []).flatMap(({ relatedIntentionIds }) => relatedIntentionIds));
  const keywords = interestKeywords(input.dynamicState);
  const ranked = input.intentions.filter(({ status }) => status === "active").flatMap((value) => {
    const reason: ContextSelectionReason | undefined = requiredIntentionReason(value, input.observation) ?? (linked.has(value.id) ? "memory-link" : hasKeywordMatch(value, keywords) ? "current-interest-keyword" : undefined);
    if (reason === undefined) return [];
    const required = reason === "scheduled-target" || reason === "trigger-match" || reason === "due";
    return [{ value, reason, required, rank: ["scheduled-target", "trigger-match", "due", "memory-link", "current-interest-keyword"].indexOf(reason) }];
  }).sort((a, b) => a.rank - b.rank || compareRecent(a.value, b.value));
  const chosen = ranked.slice(0, MAX_SELECTED).map(({ value, reason, required }) => ({ value, reason, required }));
  const chosenIds = new Set(chosen.map(({ value }) => value.id));
  const fallback = input.intentions.filter((value) => value.status === "active" && !chosenIds.has(value.id) && (value.trigger !== undefined || value.nextReviewAt !== undefined)).sort(compareRecent).slice(0, Math.min(MAX_FALLBACK, MAX_SELECTED - chosen.length)).map((value): SelectedContext<Intention> => ({ value, reason: "recent-fallback", required: false }));
  return [...chosen, ...fallback];
}

export function selectSocialContexts(input: { readonly socialContext: readonly SocialContext[]; readonly observation: Observation; readonly memories?: readonly Memory[]; readonly selectedIntentionIds?: ReadonlySet<string> }): readonly SelectedContext<SocialContext>[] {
  const explicit = new Set(explicitSubjectIds(input.observation));
  const linked = new Set((input.memories ?? []).flatMap(({ relatedSubjectIds }) => relatedSubjectIds));
  const intentionLinked = new Set((input.memories ?? []).filter(({ relatedIntentionIds }) => relatedIntentionIds.some((id) => input.selectedIntentionIds?.has(id) === true)).flatMap(({ relatedSubjectIds }) => relatedSubjectIds));
  const ranked = input.socialContext.flatMap((value) => {
    const reason: ContextSelectionReason | undefined = explicit.has(value.subjectId) ? "observation-subject" : intentionLinked.has(value.subjectId) ? "intention-memory-subject" : linked.has(value.subjectId) ? "memory-link" : undefined;
    if (reason === undefined) return [];
    return [{ value, reason, required: reason === "observation-subject", rank: ["observation-subject", "intention-memory-subject", "memory-link"].indexOf(reason) }];
  }).sort((a, b) => a.rank - b.rank || compareRecent(a.value, b.value));
  const chosen = ranked.slice(0, MAX_SELECTED).map(({ value, reason, required }) => ({ value, reason, required }));
  const chosenIds = new Set(chosen.map(({ value }) => value.id));
  const fallback = input.socialContext.filter(({ id }) => !chosenIds.has(id)).sort(compareRecent).slice(0, Math.min(MAX_FALLBACK, MAX_SELECTED - chosen.length)).map((value): SelectedContext<SocialContext> => ({ value, reason: "recent-fallback", required: false }));
  return [...chosen, ...fallback];
}

export const contextSelectionLimits = { maxSelected: MAX_SELECTED, maxFallback: MAX_FALLBACK } as const;
