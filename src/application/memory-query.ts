import type { CurrentAgentState, Memory, Observation } from "../domain/contracts.js";

export type RelevantMemoryQuery = {
  readonly text: string;
  readonly keywords: readonly string[];
  readonly subjectIds: readonly string[];
  readonly kinds: readonly Memory["kind"][];
};

export type RelevantMemoryQueryInput = {
  readonly observation: Observation;
  readonly state: CurrentAgentState;
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
  const relationships = input.state.relationships.slice(0, 8);
  const parts = [
    bounded(input.observation.summary),
    ...input.observation.facts.slice(0, 8).map((value) => bounded(value, 240)),
    ...(input.state.mood === undefined ? [] : [bounded(input.state.mood, 240)]),
    ...input.state.concerns.map(({ description, whyItMatters }) => `${bounded(description, 240)} ${bounded(whyItMatters, 240)}`),
    ...relationships.map(({ description }) => bounded(description, 240))
  ].filter((value) => value.length > 0);
  return {
    text: parts.join("\n").slice(0, 4_000),
    keywords: memoryKeywords(parts),
    subjectIds: [...new Set(relationships.map(({ subjectId }) => subjectId))],
    kinds: ["episodic", "semantic", "self-related"]
  };
}
