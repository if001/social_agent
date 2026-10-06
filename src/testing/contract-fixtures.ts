import type { AgentCoreInput, MessageEnvelope } from "../domain/contracts.js";

export const fixtureInstant = "2026-01-02T03:04:05.000Z";
export const fixtureAgentId = "agent-a";

export const messageFixture = (overrides: Partial<MessageEnvelope> = {}): MessageEnvelope => ({
  id: "message-1", destination: fixtureAgentId, source: "terminal", sentAt: fixtureInstant,
  availableAt: fixtureInstant, expiresAt: "2026-01-03T03:04:05.000Z", attempt: 0, hop: 0, payload: {}, ...overrides
});

export const agentCoreInputFixture = (): AgentCoreInput => ({
  run: { runId: "run-1", eventId: "event-1", agentId: fixtureAgentId, occurredAt: fixtureInstant },
  observation: { eventId: "event-1", summary: "A greeting arrived", facts: ["The user said hello"], observedAt: fixtureInstant },
  recentObservations: [],
  self: { id: fixtureAgentId, familyId: "family-1", identity: "A thoughtful assistant", disposition: { shared: "Curious and thoughtful", initial: "Curious and calm", acquired: "Values careful follow-through" }, values: "Honesty", interests: [], preferences: [], roles: ["Conversation partner"], selfNarrative: "I learn through experience", selfContinuity: "My memories connect my experiences", version: 0 },
  dynamicState: { agentId: fixtureAgentId, mood: "Calm", drives: [{ description: "Understand", sourceEvidenceIds: ["event-1"], since: fixtureInstant }], currentInterests: [], updatedAt: fixtureInstant },
  socialContext: [], memories: [], memoryRetrievalTrace: [], intentions: [], availableTools: [], runtimeConstraints: ["Respect system boundaries"],
  limits: { deadlineMs: 30_000, maxSteps: 8, maxToolCalls: 4, maxHops: 4, maxAttempts: 3 }
});
