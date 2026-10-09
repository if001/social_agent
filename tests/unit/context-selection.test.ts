import { explicitSubjectIds, selectIntentions, selectSocialContexts } from "../../src/application/context-selection.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import type { Intention, Memory, SocialContext } from "../../src/domain/contracts.js";

const instant = "2026-01-02T00:00:00.000Z";
const intention = (id: string, updatedAt: string, extra: Partial<Intention> = {}): Intention => ({ id, agentId: "agent-a", description: `goal ${id}`, reason: "reason", status: "active", createdAt: instant, updatedAt, ...extra });
const social = (id: string, subjectId: string, updatedAt: string, description = id): SocialContext => ({ id, agentId: "agent-a", subjectId, subjectType: "user", description, updatedAt });
const memory = (relatedSubjectIds: string[], relatedIntentionIds: string[]): Memory => ({ id: "memory", agentId: "agent-a", kind: "episodic", content: "memory", occurredAt: instant, createdAt: instant, relatedSubjectIds, relatedIntentionIds, importance: "useful", retrievalPriority: "normal", evidenceEventIds: ["event"] });

describe("relevant context selection", () => {
  it("extracts only normalized explicit subject fields", () => {
    const input = agentCoreInputFixture();
    input.observation = { ...input.observation, actor: { id: "actor", type: "human" }, content: { subjectId: "subject", projectId: "project", subjectIds: ["team"], arbitraryId: "ignored" } };
    expect(explicitSubjectIds(input.observation)).toEqual(["actor", "subject", "project", "team"]);
  });

  it("prioritizes scheduled, triggered and due intentions with stable limits", () => {
    const input = agentCoreInputFixture();
    input.observation = { ...input.observation, kind: "internal", observedAt: instant, content: { targetKind: "intention", targetId: "scheduled" } };
    const intentions = [
      intention("fallback", "2026-01-02T00:00:00Z", { trigger: { kind: "manual-review" } }),
      intention("due", "2026-01-01T00:00:00Z", { nextReviewAt: "2026-01-01T00:00:00Z" }),
      intention("triggered", "2026-01-01T00:00:00Z", { trigger: { kind: "event", eventKinds: ["internal"], keywords: [] } }),
      intention("scheduled", "2025-01-01T00:00:00Z"),
      ...Array.from({ length: 8 }, (_, index) => intention(`other-${String(index)}`, `2025-01-${String(index + 1).padStart(2, "0")}T00:00:00Z`, { trigger: { kind: "manual-review" } }))
    ];
    const selected = selectIntentions({ intentions, observation: input.observation, dynamicState: input.dynamicState });
    expect(selected).toHaveLength(5);
    expect(selected.slice(0, 3).map(({ value, reason }) => [value.id, reason])).toEqual([["scheduled", "scheduled-target"], ["triggered", "trigger-match"], ["due", "due"]]);
    expect(selected.filter(({ reason }) => reason === "recent-fallback")).toHaveLength(2);
  });

  it("uses Memory links and current interests but excludes unrelated reviewless intentions", () => {
    const input = agentCoreInputFixture();
    input.dynamicState = { ...input.dynamicState, currentInterests: [{ id: "interest", focus: "分散検索を知りたい", goal: "分散検索を説明する", progress: 25 }] };
    const selected = selectIntentions({ intentions: [intention("linked", instant), intention("keyword", instant, { description: "分散検索を調べる" }), intention("unrelated", instant)], observation: input.observation, dynamicState: input.dynamicState, memories: [memory([], ["linked"])] });
    expect(selected.map(({ value, reason }) => [value.id, reason])).toEqual([["linked", "memory-link"], ["keyword", "current-interest-keyword"]]);
  });

  it("prioritizes actor and intention-linked subjects over newer unrelated contexts", () => {
    const input = agentCoreInputFixture(); input.observation = { ...input.observation, actor: { id: "owner", type: "human" } };
    const selected = selectSocialContexts({ socialContext: [social("new", "other", "2026-02-01T00:00:00Z"), social("actor", "owner", "2025-01-01T00:00:00Z"), social("linked", "project", "2025-01-01T00:00:00Z")], observation: input.observation, memories: [memory(["project"], ["goal"])], selectedIntentionIds: new Set(["goal"]) });
    expect(selected.map(({ value, reason }) => [value.id, reason])).toEqual([["actor", "observation-subject"], ["linked", "intention-memory-subject"], ["new", "recent-fallback"]]);
  });
});
