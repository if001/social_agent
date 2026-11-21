import { describe, expect, it } from "vitest";

import { ObservationGate, type ObservationGateDecision, type ObservationGateModel } from "../../src/application/observation-gate.js";
import { observationGateSystemPrompt } from "../../src/infrastructure/agent/observation-gate-model.js";
import type { DomainEvent } from "../../src/domain/contracts.js";

const event: DomainEvent = { id: "observed-1", agentId: "shiro", kind: "message-received", occurredAt: "2026-11-21T00:00:00.000Z", payload: { text: "噂の変質まわりを読んでいる", senderKind: "peer", addressing: "observed", peerName: "aka", subjectId: "agent:aka" } };

describe("ObservationGate", () => {
  it("FR-91: frames engagement as the Agent's own curiosity and feeling, not a reply obligation", () => {
    expect(observationGateSystemPrompt).toContain("自分の好奇心");
    expect(observationGateSystemPrompt).toContain("現在のMood");
    expect(observationGateSystemPrompt).toContain("返信すべきか");
    expect(observationGateSystemPrompt).toContain("では決めない");
    expect(observationGateSystemPrompt).toContain("具体的な未解決の問い");
    expect(observationGateSystemPrompt).toContain("長期的な協力関係");
  });

  it("FR-91, NFR-21: passes only bounded ID-free social context to the one-shot model", async () => {
    let received: unknown;
    const gate = new ObservationGate({ load: () => Promise.resolve({ text: "噂の変質まわりを読んでいる", peerName: "aka", self: { disposition: "好奇心が強い", story: "議論の食い違いを面白がる" }, mood: "少し高揚している", relationship: "議論すると面白い相手", concerns: ["出典の変質が気になる"], memories: ["akaとの前の話で実験を参照した"] }) }, { decide: (input) => { received = input; return Promise.resolve({ decision: "engage", reason: "前の議論に接続する" }); } });
    await expect(gate.decide(event, new AbortController().signal)).resolves.toEqual({ decision: "engage", reason: "前の議論に接続する", input: { text: "噂の変質まわりを読んでいる", peerName: "aka", self: { disposition: "好奇心が強い", story: "議論の食い違いを面白がる" }, mood: "少し高揚している", relationship: "議論すると面白い相手", concerns: ["出典の変質が気になる"], memories: ["akaとの前の話で実験を参照した"] }, modelCalls: 1, retrievalCount: 1 });
    expect(received).toEqual(expect.objectContaining({ peerName: "aka", mood: "少し高揚している", self: { disposition: "好奇心が強い", story: "議論の食い違いを面白がる" }, relationship: "議論すると面白い相手" }));
    expect(JSON.stringify(received)).not.toContain("observed-1");
    expect(JSON.stringify(received)).not.toContain("agent:aka");
  });

  it("FR-91, NFR-21: fails closed when an optional observed-post Gate cannot decide", async () => {
    const gate = new ObservationGate({ load: () => Promise.reject(new Error("database unavailable")) }, { decide: () => Promise.resolve({ decision: "ignore", reason: "unused" }) });
    await expect(gate.decide(event, new AbortController().signal)).resolves.toMatchObject({ decision: "ignore", modelCalls: 0, retrievalCount: 0, failureReason: "database unavailable" });
  });

  it("FR-91, NFR-21: fails closed when the Gate provider rejects or returns schema-invalid output", async () => {
    const input = { text: "案を採用する", peerName: "aka", self: { disposition: "気まま", story: "気になる差分を追う" }, mood: "落ち着いている", concerns: [], memories: [] };
    const models: readonly ObservationGateModel[] = [
      { decide: () => Promise.reject(new Error("provider unavailable")) },
      { decide: () => Promise.resolve({ decision: "engage" } as unknown as ObservationGateDecision) }
    ];
    for (const model of models) {
      const gate = new ObservationGate({ load: () => Promise.resolve(input) }, model);
      const result = await gate.decide(event, new AbortController().signal);
      expect(result).toMatchObject({ decision: "ignore", modelCalls: 1, retrievalCount: 1 });
      expect(typeof result.failureReason).toBe("string");
    }
  });
});
