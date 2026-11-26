import { describe, expect, it } from "vitest";

import { ConversationGoalComposer } from "../../src/application/conversation-goal.js";
import { conversationGoalSystemPrompt } from "../../src/infrastructure/agent/conversation-goal-model.js";
import type { DomainEvent } from "../../src/domain/contracts.js";

const event: DomainEvent = { id: "message-1", agentId: "shiro", kind: "message-received", occurredAt: "2026-11-26T00:00:00.000Z", payload: { text: "その資料の結論は逆かもしれない", senderKind: "peer", addressing: "direct", peerName: "aka" } };

describe("ConversationGoalComposer", () => {
  it("creates a goal before Agent Core from an agent-owned reason, not an answer", async () => {
    const composer = new ConversationGoalComposer({ load: async () => ({ text: "その資料の結論は逆かもしれない", peerName: "aka", self: { disposition: "食い違いを放っておけない", story: "検証の穴を拾う" }, mood: "少し気になる", concerns: [], memories: [] }) }, { compose: async (_input, reason) => {
      expect(reason).toContain("直接話しかけられた");
      return { goal: "資料の結論を分けた根拠を確かめる" };
    } });
    await expect(composer.compose(event, "相手から直接話しかけられたため、自分がこの会話で得たいことを定める", new AbortController().signal)).resolves.toEqual({ goal: "資料の結論を分けた根拠を確かめる" });
  });

  it("does not let the goal model choose delivery or an answer", () => {
    expect(conversationGoalSystemPrompt).toContain("応答本文や配送先は作らない");
    expect(conversationGoalSystemPrompt).toContain("返信すること、礼儀");
  });
});
