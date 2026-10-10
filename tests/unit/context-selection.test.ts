import { explicitSubjectIds, selectSocialContexts } from "../../src/application/context-selection.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import type { Memory, SocialContext } from "../../src/domain/contracts.js";

const instant = "2026-01-02T00:00:00.000Z";
const social = (id: string, subjectId: string, updatedAt: string): SocialContext => ({ id, agentId: "agent-a", subjectId, subjectType: "user", description: id, updatedAt });
const memory = (relatedSubjectIds: string[]): Memory => ({ id: "memory", agentId: "agent-a", kind: "episodic", content: "memory", occurredAt: instant, createdAt: instant, relatedSubjectIds, importance: "useful", retrievalPriority: "normal", evidenceEventIds: ["event"] });

describe("relevant context selection", () => {
  it("extracts only normalized explicit subject fields", () => {
    const input = agentCoreInputFixture();
    input.observation = { ...input.observation, actor: { id: "actor", type: "human" }, content: { subjectId: "subject", projectId: "project", subjectIds: ["team"], arbitraryId: "ignored" } };
    expect(explicitSubjectIds(input.observation)).toEqual(["actor", "subject", "project", "team"]);
  });

  it("prioritizes the observed and memory-linked subjects", () => {
    const input = agentCoreInputFixture(); input.observation = { ...input.observation, actor: { id: "owner", type: "human" } };
    const selected = selectSocialContexts({ socialContext: [social("new", "other", "2026-02-01T00:00:00Z"), social("actor", "owner", "2025-01-01T00:00:00Z"), social("linked", "project", "2025-01-01T00:00:00Z")], observation: input.observation, memories: [memory(["project"])] });
    expect(selected.map(({ value, reason }) => [value.id, reason])).toEqual([["actor", "observation-subject"], ["linked", "memory-link"], ["new", "recent-fallback"]]);
  });
});
