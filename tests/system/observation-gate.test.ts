import { describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "../../src/application/agent-runtime.js";
import { ObservationGate } from "../../src/application/observation-gate.js";
import { SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { InMemoryRuntimePersistence } from "../../src/testing/in-memory-runtime-persistence.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import type { MessageEnvelope } from "../../src/domain/contracts.js";

const observed: MessageEnvelope = { id: "message-observed", destination: "shiro", source: "discord:aka", sentAt: "2026-11-21T00:00:00.000Z", availableAt: "2026-11-21T00:00:00.000Z", expiresAt: "2026-11-22T00:00:00.000Z", attempt: 0, hop: 0, payload: { type: "message-received", text: "今日はこの話、もう飽きた", senderKind: "peer", addressing: "observed", actorId: "discord-aka", peerName: "aka", sourceType: "discord", sourceId: "channel" } };

describe("peer observed Observation Gate", () => {
  it("FR-91: ignores an observed peer post without invoking Agent Core or producing an outbox record", async () => {
    const persistence = new InMemoryRuntimePersistence((event) => { const input = agentCoreInputFixture(); input.run.eventId = event.id; input.run.agentId = event.agentId; input.currentSelf.agentId = event.agentId; input.state.agentId = event.agentId; return input; });
    const run = vi.fn(() => Promise.resolve({ output: { desire: "respond", action: { type: "respond" as const, content: "should not run" } }, toolExecutions: [] }));
    const gate = new ObservationGate({ load: () => Promise.resolve({ text: "今日はこの話、もう飽きた", peerName: "aka", self: { disposition: "気まま", story: "自分の寄り道を優先する" }, mood: "退屈している", concerns: [], memories: [] }) }, { decide: () => Promise.resolve({ decision: "ignore" as const, reason: "今の関心と接続しない" }) });
    // Use the public queue contract with a one-shot subscriber.
    let consume: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const oneShotQueue = { publish: () => Promise.resolve(), subscribe: (_destination: string, next: (message: MessageEnvelope) => Promise<void>) => { consume = next; return Promise.resolve(); } };
    const oneShotRuntime = new AgentRuntime({ destination: "shiro", defaultOutputDestination: "discord", queue: oneShotQueue, harness: { run }, persistence, observationGate: gate, ids: new SequenceIdGenerator(["event-ignore"]), now: () => new Date("2026-11-21T00:00:00.000Z") });
    await oneShotRuntime.start(new AbortController().signal); await consume?.(observed);
    expect(run).not.toHaveBeenCalled();
    expect(persistence.events).toHaveLength(1);
    expect(persistence.ignoredObservations).toHaveLength(1);
    expect(await persistence.pendingOutbox(10)).toEqual([]);
  });

  it("FR-91: engages observed posts once and bypasses the Gate for peer/direct", async () => {
    const persistence = new InMemoryRuntimePersistence((event) => { const input = agentCoreInputFixture(); input.run.eventId = event.id; input.run.agentId = event.agentId; input.currentSelf.agentId = event.agentId; input.state.agentId = event.agentId; return input; });
    const gateDecide = vi.fn(() => Promise.resolve({ decision: "engage" as const, reason: "反論したい" }));
    const gate = new ObservationGate({ load: () => Promise.resolve({ text: "投稿", peerName: "aka", self: { disposition: "気まま", story: "自分の寄り道を優先する" }, mood: "少し高揚している", concerns: [], memories: [] }) }, { decide: gateDecide });
    const run = vi.fn(() => Promise.resolve({ output: { desire: "反論する", action: { type: "no-external-action" as const, reason: "test" } }, toolExecutions: [] }));
    let consume: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const oneShotQueue = { publish: () => Promise.resolve(), subscribe: (_destination: string, next: (message: MessageEnvelope) => Promise<void>) => { consume = next; return Promise.resolve(); } };
    const runtime = new AgentRuntime({ destination: "shiro", defaultOutputDestination: "discord", queue: oneShotQueue, harness: { run }, persistence, observationGate: gate, ids: new SequenceIdGenerator(["event-engage", "run-output", "event-direct"]), now: () => new Date("2026-11-21T00:00:00.000Z") });
    await runtime.start(new AbortController().signal); await consume?.(observed);
    await consume?.({ ...observed, id: "message-direct", payload: { ...observed.payload, addressing: "direct" } });
    expect(gateDecide).toHaveBeenCalledTimes(1);
    expect(run).toHaveBeenCalledTimes(2);
    expect(persistence.ignoredObservations).toHaveLength(0);
  });
});
