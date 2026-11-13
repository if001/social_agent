import { estimateTokens } from "./context-builder.js";
import type { ReflectionInput } from "./reflection.js";

const MAX_FIXED_CONTENT_TOKENS = 5_000;
const MAX_MEMORY_CONTENT_TOKENS = 1_600;
const MAX_CONCERNS = 16;

type ConcernView = { readonly description: string; readonly whyItMatters: string; readonly status: "active"; readonly reconsiderAt?: string };
type MemoryView = { readonly kind: string; readonly summary: string; readonly significance: string; readonly occurredAt: string };

export type ReflectionConcernContext = {
  readonly memories: readonly MemoryView[];
  readonly concerns: readonly ConcernView[];
  readonly stats: { readonly total: number; readonly active: number; readonly overdue: number; readonly selected: number; readonly memorySelected: number; readonly estimatedContentTokens: number };
};

function concernRank(value: { readonly reconsiderAt?: string | undefined }, now: number): readonly [number, number] {
  if (value.reconsiderAt === undefined) return [1, 0];
  const time = Date.parse(value.reconsiderAt);
  return time <= now ? [0, time] : [2, time];
}

/** Select whole records only; no Concern or Memory text is mechanically cut. */
export function reflectionConcernContext(input: Pick<ReflectionInput, "memories" | "state">, now: Date = new Date()): ReflectionConcernContext {
  const memoryCandidates: MemoryView[] = input.memories.map(({ kind, summary, significance, occurredAt }) => ({ kind: kind ?? "episodic", summary, significance, occurredAt }));
  const memories: MemoryView[] = [];
  let memoryTokens = 0;
  for (const memory of memoryCandidates) {
    const cost = estimateTokens(memory);
    if (memoryTokens + cost > MAX_MEMORY_CONTENT_TOKENS) continue;
    memories.push(memory);
    memoryTokens += cost;
  }
  const total = input.state.concerns.length;
  const active = input.state.concerns.filter((concern) => concern.status === "active");
  const nowMs = now.getTime();
  const ordered = active.map((concern, index) => ({ concern, index, rank: concernRank(concern, nowMs) }))
    .sort((left, right) => left.rank[0] - right.rank[0] || left.rank[1] - right.rank[1] || left.index - right.index)
    .map(({ concern }) => concern);
  const concerns: ConcernView[] = [];
  let contentTokens = memoryTokens;
  for (const concern of ordered) {
    if (concerns.length >= MAX_CONCERNS) break;
    const view: ConcernView = { description: concern.description, whyItMatters: concern.whyItMatters, status: "active", ...(concern.reconsiderAt === undefined ? {} : { reconsiderAt: concern.reconsiderAt }) };
    const cost = estimateTokens(view);
    if (contentTokens + cost > MAX_FIXED_CONTENT_TOKENS) continue;
    concerns.push(view);
    contentTokens += cost;
  }
  const overdue = active.filter((concern) => concern.reconsiderAt !== undefined && Date.parse(concern.reconsiderAt) <= nowMs).length;
  return { memories, concerns, stats: { total, active: active.length, overdue, selected: concerns.length, memorySelected: memories.length, estimatedContentTokens: contentTokens } };
}
