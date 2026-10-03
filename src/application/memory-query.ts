import type { DynamicState, Intention, Memory, Observation, SocialContext } from "../domain/contracts.js";

export type RelevantMemoryQuery = {
  readonly text: string;
  readonly keywords: readonly string[];
  readonly subjectIds: readonly string[];
  readonly intentionIds: readonly string[];
  readonly kinds: readonly Memory["kind"][];
};

export type RelevantMemoryQueryInput = {
  readonly observation: Observation;
  readonly dynamicState: DynamicState;
  readonly intentions: readonly Intention[];
  readonly socialContext: readonly SocialContext[];
};

const bounded = (value: string, length = 500): string => value.trim().slice(0, length);

export function memoryKeywords(parts: readonly string[], limit = 32): readonly string[] {
  const result = new Set<string>();
  for (const raw of parts) {
    const normalized = raw.normalize("NFKC").toLocaleLowerCase("ja");
    for (const token of normalized.match(/[\p{L}\p{N}]+/gu) ?? []) {
      if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(token)) result.add(token.slice(0, 64));
      else {
        for (let index = 0; index < token.length - 1; index += 2) result.add(token.slice(index, index + 2));
      }
      if (result.size >= limit) return [...result];
    }
  }
  return [...result];
}

export function buildRelevantMemoryQuery(input: RelevantMemoryQueryInput): RelevantMemoryQuery {
  const activeIntentions = input.intentions.filter(({ status }) => status === "active").slice(0, 8);
  const social = input.socialContext.slice(0, 8);
  const parts = [
    bounded(input.observation.summary),
    ...input.observation.facts.slice(0, 8).map((value) => bounded(value, 240)),
    bounded(input.dynamicState.emotion, 240), bounded(input.dynamicState.mood, 240), bounded(input.dynamicState.drive, 240), bounded(input.dynamicState.desire, 240),
    ...activeIntentions.map(({ description, reason }) => `${bounded(description, 240)} ${bounded(reason, 160)}`),
    ...social.map(({ description }) => bounded(description, 240))
  ].filter((value) => value.length > 0);
  return {
    text: parts.join("\n").slice(0, 4_000),
    keywords: memoryKeywords(parts),
    subjectIds: [...new Set(social.map(({ subjectId }) => subjectId))],
    intentionIds: activeIntentions.map(({ id }) => id),
    kinds: ["episodic", "semantic", "self-related"]
  };
}
