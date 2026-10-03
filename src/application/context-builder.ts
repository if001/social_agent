import type { Agent, AgentCoreInput, DynamicState, Intention, Memory, MemoryRetrievalTrace, Observation, RunLimits, SocialContext } from "../domain/contracts.js";

export type ContextBudget = { readonly maxTokens: number; readonly maxMemories: number; readonly maxSocialContexts: number };
export type ContextSource = { readonly run: AgentCoreInput["run"]; readonly observation: Observation; readonly recentObservations: readonly Observation[]; readonly self: Agent; readonly dynamicState: DynamicState; readonly socialContext: readonly SocialContext[]; readonly memories: readonly Memory[]; readonly memoryRetrievalTrace: readonly MemoryRetrievalTrace[]; readonly intentions: readonly Intention[]; readonly availableTools: AgentCoreInput["availableTools"]; readonly runtimeConstraints: readonly string[]; readonly limits: RunLimits };
const tokens = (value: unknown): number => Math.ceil(JSON.stringify(value).length / 4);

export class ContextBuilder {
  build(source: ContextSource, budget: ContextBudget): AgentCoreInput {
    if (source.self.id !== source.run.agentId || source.dynamicState.agentId !== source.run.agentId) throw new Error("Context owner mismatch");
    const socialContext = source.socialContext.filter((item) => item.agentId === source.run.agentId).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt) || a.id.localeCompare(b.id)).slice(0, budget.maxSocialContexts);
    const memories = source.memories.filter((item) => item.agentId === source.run.agentId).slice(0, budget.maxMemories);
    const intentions = source.intentions.filter((item) => item.agentId === source.run.agentId && item.status === "active").sort((a, b) => a.id.localeCompare(b.id));
    const base = { run: source.run, observation: source.observation, recentObservations: [...source.recentObservations], self: source.self, dynamicState: source.dynamicState, intentions, availableTools: [...source.availableTools], runtimeConstraints: [...source.runtimeConstraints], limits: source.limits };
    const selectedSocial: SocialContext[] = []; const selectedMemories: Memory[] = []; let used = tokens(base);
    for (const item of socialContext) { const cost = tokens(item); if (used + cost <= budget.maxTokens) { selectedSocial.push(item); used += cost; } }
    for (const item of memories) { const cost = tokens(item); if (used + cost <= budget.maxTokens) { selectedMemories.push(item); used += cost; } }
    if (used > budget.maxTokens) throw new Error("Context budget is too small for required state");
    const selectedIds = new Set(selectedMemories.map(({ id }) => id));
    const memoryRetrievalTrace = source.memoryRetrievalTrace.map((item) => item.selected && !selectedIds.has(item.memoryId) ? { ...item, selected: false, exclusionReason: "context-budget" as const } : item);
    return { ...base, socialContext: selectedSocial, memories: selectedMemories, memoryRetrievalTrace };
  }
}
