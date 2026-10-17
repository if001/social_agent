import type { AgentCoreInput, BotPersona, Memory, MemoryRetrievalTrace, Observation, RecentExperience } from "../domain/contracts.js";
import { noopLogger, type Logger } from "../observability/logger.js";

export type ContextBudget = { readonly maxTokens: number; readonly maxMemories: number; readonly maxSocialContexts: number };
export type ContextSource = Omit<AgentCoreInput, "memories" | "memoryRetrievalTrace"> & { readonly memories: readonly Memory[]; readonly memoryRetrievalTrace: readonly MemoryRetrievalTrace[] };
export const estimateTokens = (value: unknown): number => Math.ceil(JSON.stringify(value).length / 4);
const text = (value: string, limit: number): string => value.slice(0, limit);
const texts = (values: readonly string[], count = 16, limit = 500): string[] => values.slice(0, count).map((value) => text(value, limit));

function observation(value: Observation): Observation {
  const serializedContent = value.content === undefined ? undefined : JSON.stringify(value.content);
  return { ...value, summary: text(value.summary, 1_000), facts: texts(value.facts, 8, 240), ...(serializedContent === undefined || serializedContent.length > 4_000 ? { content: undefined } : {}) };
}

function persona(value: BotPersona | undefined): BotPersona | undefined {
  if (value === undefined) return undefined;
  return { ...value, identity: { displayName: text(value.identity.displayName, 200), ...(value.identity.description === undefined ? {} : { description: text(value.identity.description, 500) }) }, communication: { language: text(value.communication.language, 100), firstPerson: text(value.communication.firstPerson, 100), tone: texts(value.communication.tone, 8, 240), responseStyle: texts(value.communication.responseStyle, 8, 240), avoid: texts(value.communication.avoid, 8, 240) } };
}

export class ContextBuilder {
  constructor(private readonly logger: Logger = noopLogger) {}
  build(source: ContextSource, budget: ContextBudget): AgentCoreInput {
    if (source.currentSelf.agentId !== source.run.agentId || source.state.agentId !== source.run.agentId) throw new Error("Context owner mismatch");
    const currentSelf = { ...source.currentSelf, identity: text(source.currentSelf.identity, 300), disposition: text(source.currentSelf.disposition, 1_200), selfStory: text(source.currentSelf.selfStory, 1_000), commitments: texts(source.currentSelf.commitments, 12, 400) };
    const state = { ...source.state, ...(source.state.mood === undefined ? {} : { mood: text(source.state.mood, 500) }), concerns: source.state.concerns.slice(0, 12).map((concern) => ({ ...concern, description: text(concern.description, 500), whyItMatters: text(concern.whyItMatters, 500) })), relationships: source.state.relationships.slice(0, 12).map((relationship) => ({ ...relationship, description: text(relationship.description, 600) })) };
    const boundedPersona = persona(source.persona);
    const required = { run: source.run, observation: observation(source.observation), ...(source.previousAssessment === undefined ? {} : { previousAssessment: source.previousAssessment }), ...(boundedPersona === undefined ? {} : { persona: boundedPersona }), currentSelf, state, runtimeConstraints: texts(source.runtimeConstraints, 16, 1_000), limits: source.limits };
    let used = estimateTokens(required);
    if (used > budget.maxTokens) throw new Error(`Context budget is too small for required state: required=${String(used)}, max=${String(budget.maxTokens)}`);
    const recentCandidates = source.recentExperiences.filter(({ agentId }) => agentId === source.run.agentId).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId)).slice(-2);
    const recentExperiences: RecentExperience[] = [...recentCandidates];
    let recentCost = recentExperiences.reduce((sum, value) => sum + estimateTokens(value), 0);
    while (recentExperiences.length > 0 && used + recentCost > budget.maxTokens) {
      const removed = recentExperiences.shift();
      if (removed !== undefined) { recentCost -= estimateTokens(removed); this.logger.log("warn", "context.recent_experience_excluded", { agentId: source.run.agentId, eventId: removed.eventId, reason: recentExperiences.length === 0 ? "single-event-budget" : "context-budget" }); }
    }
    used += recentCost;
    const recentEventIds = new Set(recentExperiences.map(({ eventId }) => eventId));
    const duplicateMemoryIds = new Set(source.memories.filter((item) => item.agentId === source.run.agentId && item.kind === "episodic" && (item.retrievalPriority === "low" || item.retrievalPriority === "normal") && item.evidenceEventIds.some((id) => recentEventIds.has(id))).map(({ id }) => id));
    if (duplicateMemoryIds.size > 0) this.logger.log("info", "context.memory_duplicates_excluded", { agentId: source.run.agentId, count: duplicateMemoryIds.size });
    const selectedMemories: Memory[] = [];
    for (const item of source.memories.filter((item) => item.agentId === source.run.agentId && !duplicateMemoryIds.has(item.id)).slice(0, Math.min(5, budget.maxMemories))) {
      const bounded = { ...item, content: text(item.content, 1_200), importance: text(item.importance, 300) };
      const cost = estimateTokens(bounded);
      if (used + cost <= budget.maxTokens) { selectedMemories.push(bounded); used += cost; }
    }
    const selectedIds = new Set(selectedMemories.map(({ id }) => id));
    const memoryRetrievalTrace = source.memoryRetrievalTrace.map((item) => duplicateMemoryIds.has(item.memoryId) ? { ...item, selected: false, exclusionReason: "recent-experience-duplicate" as const } : item.selected && !selectedIds.has(item.memoryId) ? { ...item, selected: false, exclusionReason: "context-budget" as const } : item);
    return { ...required, recentExperiences, memories: selectedMemories, memoryRetrievalTrace, availableTools: [...source.availableTools] };
  }
}
