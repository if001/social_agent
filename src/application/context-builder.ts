import type { AgentCoreInput, BotPersona, Memory, MemoryRetrievalTrace, Observation, RecentExperience, SocialContext } from "../domain/contracts.js";
import { noopLogger, type Logger } from "../observability/logger.js";

export type ContextBudget = { readonly maxTokens: number; readonly maxMemories: number; readonly maxSocialContexts: number };
export type ContextSource = Omit<AgentCoreInput, "socialContext" | "memories" | "memoryRetrievalTrace"> & { readonly socialContext: readonly SocialContext[]; readonly memories: readonly Memory[]; readonly memoryRetrievalTrace: readonly MemoryRetrievalTrace[]; readonly requiredSocialContextIds?: ReadonlySet<string> };
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
    if (source.self.id !== source.run.agentId || source.dynamicState.agentId !== source.run.agentId) throw new Error("Context owner mismatch");
    const boundedSelf = { ...source.self, identity: text(source.self.identity, 300), disposition: { shared: text(source.self.disposition.shared, 500), initial: text(source.self.disposition.initial, 500), acquired: text(source.self.disposition.acquired, 500) }, values: text(source.self.values, 700), interests: texts(source.self.interests, 6, 240), preferences: texts(source.self.preferences, 6, 240), roles: texts(source.self.roles, 4, 240), ...(source.self.raisonDetre === undefined ? {} : { raisonDetre: text(source.self.raisonDetre, 400) }), selfNarrative: text(source.self.selfNarrative, 500), selfContinuity: text(source.self.selfContinuity, 500) };
    const boundedState = { ...source.dynamicState, mood: text(source.dynamicState.mood, 500), motives: source.dynamicState.motives.slice(0, 3).map((motive) => ({ ...motive, description: text(motive.description, 400), ...(motive.goal === undefined ? {} : { goal: text(motive.goal, 400) }), sourceEvidenceIds: motive.sourceEvidenceIds.slice(0, 8) })), motiveExploration: source.dynamicState.motiveExploration.filter(({ motiveId }) => source.dynamicState.motives.slice(0, 3).some(({ id }) => id === motiveId)) };
    const boundedPersona = persona(source.persona);
    const required = { run: source.run, observation: observation(source.observation), ...(boundedPersona === undefined ? {} : { persona: boundedPersona }), self: boundedSelf, dynamicState: boundedState, availableTools: source.availableTools.map(({ name, description }) => ({ name, description: text(description, 500) })), runtimeConstraints: texts(source.runtimeConstraints, 16, 1_000), limits: source.limits };
    let used = estimateTokens(required); if (used > budget.maxTokens) throw new Error(`Context budget is too small for required state: required=${String(used)}, max=${String(budget.maxTokens)}`);

    const recentCandidates = source.recentExperiences.filter(({ agentId }) => agentId === source.run.agentId).sort((a, b) => a.occurredAt.localeCompare(b.occurredAt) || a.eventId.localeCompare(b.eventId)).slice(-4);
    const recentExperiences: RecentExperience[] = [...recentCandidates]; let recentCost = recentExperiences.reduce((sum, value) => sum + estimateTokens(value), 0);
    while (recentExperiences.length > 0 && used + recentCost > budget.maxTokens) { const removed = recentExperiences.shift(); if (removed !== undefined) { recentCost -= estimateTokens(removed); this.logger.log("warn", "context.recent_experience_excluded", { agentId: source.run.agentId, eventId: removed.eventId, reason: recentExperiences.length === 0 ? "single-event-budget" : "context-budget" }); } }
    used += recentCost;
    const selectedSocial: SocialContext[] = [];
    const addSocial = (item: SocialContext): void => { const bounded = { ...item, description: text(item.description, 600) }; const cost = estimateTokens(bounded); if (used + cost <= budget.maxTokens) { selectedSocial.push(bounded); used += cost; } };
    const ownedSocial = source.socialContext.filter((item) => item.agentId === source.run.agentId).slice(0, Math.min(1, budget.maxSocialContexts));
    for (const item of ownedSocial.filter(({ id }) => source.requiredSocialContextIds?.has(id) === true)) addSocial(item);
    const recentEventIds = new Set(recentExperiences.map(({ eventId }) => eventId));
    const duplicateMemoryIds = new Set(source.memories.filter((item) => item.agentId === source.run.agentId && item.kind === "episodic" && (item.retrievalPriority === "low" || item.retrievalPriority === "normal") && item.evidenceEventIds.some((id) => recentEventIds.has(id))).map(({ id }) => id));
    if (duplicateMemoryIds.size > 0) this.logger.log("debug", "context.memory_duplicates_excluded", { agentId: source.run.agentId, count: duplicateMemoryIds.size, memoryIds: JSON.stringify([...duplicateMemoryIds]) });
    const selectedMemories: Memory[] = []; for (const item of source.memories.filter((item) => item.agentId === source.run.agentId && !duplicateMemoryIds.has(item.id)).slice(0, Math.min(5, budget.maxMemories))) { const bounded = { ...item, content: text(item.content, 1_200), importance: text(item.importance, 300) }; const cost = estimateTokens(bounded); if (used + cost <= budget.maxTokens) { selectedMemories.push(bounded); used += cost; } }
    const selectedSocialIds = new Set(selectedSocial.map(({ id }) => id)); for (const item of ownedSocial) if (!selectedSocialIds.has(item.id)) addSocial(item);
    const selectedIds = new Set(selectedMemories.map(({ id }) => id)); const memoryRetrievalTrace = source.memoryRetrievalTrace.map((item) => duplicateMemoryIds.has(item.memoryId) ? { ...item, selected: false, exclusionReason: "recent-experience-duplicate" as const } : item.selected && !selectedIds.has(item.memoryId) ? { ...item, selected: false, exclusionReason: "context-budget" as const } : item);
    return { run: source.run, observation: required.observation, recentExperiences, ...(boundedPersona === undefined ? {} : { persona: boundedPersona }), self: boundedSelf, dynamicState: boundedState, socialContext: selectedSocial, memories: selectedMemories, memoryRetrievalTrace, availableTools: [...source.availableTools], runtimeConstraints: texts(source.runtimeConstraints, 16, 1_000), limits: source.limits };
  }
}
