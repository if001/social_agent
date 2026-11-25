import { describe, expect, it } from "vitest";

import { ConcernReevaluation } from "../../src/application/concern-reevaluation.js";

const source = { agentId: "a", sourceKind: "experience-integration", sourceId: "i", sourceEventId: "e", sourceRunId: "r", memoryIds: ["m1", "m2"] };

describe("ConcernReevaluation", () => {
  it("FR-24, FR-69: creates one assessment for a Memory group and discards it without an Event when no active Concern matches", async () => {
    const calls: string[] = [];
    const service = new ConcernReevaluation({
      begin: async () => "created",
      focus: async () => undefined,
      input: async () => { throw new Error("not reached"); },
      discard: async () => { calls.push("discard"); },
      pending: async () => { calls.push("pending"); },
      fail: async () => { calls.push("fail"); }
    }, { assess: async () => ({ decision: "none", reason: "unused" }) });
    await service.consider(source, new AbortController().signal);
    expect(calls).toEqual(["discard"]);
  });

  it("FR-24, FR-69: binds exactly one Runtime-selected parent and leaves a reconsideration batch pending", async () => {
    let received: unknown;
    const service = new ConcernReevaluation({
      begin: async () => "created",
      focus: async () => ({ concernId: "c1", description: "展示の現況を知りたい", whyItMatters: "自分に残っている" }),
      input: async (_source, focus) => ({ source, focus, experienceSummary: "展示の現況を聞いた", memories: [{ content: "ユーザーは展示へ行った", importance: "今後の判断に使う" }] }),
      discard: async () => undefined,
      pending: async (_source, focus, impact) => { received = { focus, impact }; },
      fail: async () => undefined
    }, { assess: async () => ({ decision: "reconsider", reason: "見学後の現況という別の関心が残った" }) });
    await service.consider(source, new AbortController().signal);
    expect(received).toEqual({ focus: { concernId: "c1", description: "展示の現況を知りたい", whyItMatters: "自分に残っている" }, impact: { decision: "reconsider", reason: "見学後の現況という別の関心が残った" } });
  });
});
