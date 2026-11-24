import { estimateTokens } from "./context-builder.js";
import type { ReflectionInput } from "./reflection.js";

const MAX_FIXED_CONTENT_TOKENS = 5_000;
const MAX_MEMORY_CONTENT_TOKENS = 1_600;
const MAX_CONCERNS = 16;

type ConcernView = { readonly description: string; readonly whyItMatters: string; readonly status: "active" };
type MemoryView = { readonly kind: string; readonly summary: string; readonly significance: string; readonly occurredAt: string };

export type ReflectionConcernContext = {
  readonly memories: readonly MemoryView[];
  readonly concerns: readonly ConcernView[];
  readonly stats: { readonly total: number; readonly active: number; readonly selected: number; readonly memorySelected: number; readonly estimatedContentTokens: number };
};

/** Select whole records only; no Concern or Memory text is mechanically cut. */
export function reflectionConcernContext(input: Pick<ReflectionInput, "memories" | "state">, _now: Date = new Date()): ReflectionConcernContext {
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
  const ordered = active;
  const concerns: ConcernView[] = [];
  let contentTokens = memoryTokens;
  for (const concern of ordered) {
    if (concerns.length >= MAX_CONCERNS) break;
    const view: ConcernView = { description: concern.description, whyItMatters: concern.whyItMatters, status: "active" };
    const cost = estimateTokens(view);
    if (contentTokens + cost > MAX_FIXED_CONTENT_TOKENS) continue;
    concerns.push(view);
    contentTokens += cost;
  }
  return { memories, concerns, stats: { total, active: active.length, selected: concerns.length, memorySelected: memories.length, estimatedContentTokens: contentTokens } };
}
