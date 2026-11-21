import { describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "../../src/application/agent-runtime.js";
import { ObservationGate } from "../../src/application/observation-gate.js";
import { SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { InMemoryRuntimePersistence } from "../../src/testing/in-memory-runtime-persistence.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import type { MessageEnvelope } from "../../src/domain/contracts.js";
import type { ExperienceIntegrationInput } from "../../src/application/experience-integration.js";

const observed: MessageEnvelope = { id: "message-observed", destination: "shiro", source: "discord:aka", sentAt: "2026-11-21T00:00:00.000Z", availableAt: "2026-11-21T00:00:00.000Z", expiresAt: "2026-11-22T00:00:00.000Z", attempt: 0, hop: 0, payload: { type: "message-received", text: "今日はこの話、もう飽きた", senderKind: "peer", addressing: "observed", actorId: "discord-aka", peerName: "aka", sourceType: "discord", sourceId: "channel" } };

describe("peer observed Observation Gate", () => {
  it("FR-21, FR-76, FR-90: records a direct peer closure without replying when its Desire is already satisfied", async () => {
    const persistence = new InMemoryRuntimePersistence((event) => { const input = agentCoreInputFixture(); input.run.eventId = event.id; input.run.agentId = event.agentId; input.currentSelf.agentId = event.agentId; input.state.agentId = event.agentId; return input; });
    const run = vi.fn(() => Promise.resolve({ output: { desire: "予定確認は済んだので会話を伸ばさない", action: { type: "no-external-action" as const, reason: "新しい問いや対象がなく、会話目的は満たされた" } }, toolExecutions: [] }));
    const enqueued: Omit<ExperienceIntegrationInput, "integrationId">[] = [];
    const enqueue = (input: Omit<ExperienceIntegrationInput, "integrationId">): Promise<void> => { enqueued.push(input); return Promise.resolve(); };
    let consume: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const oneShotQueue = { publish: () => Promise.resolve(), subscribe: (_destination: string, next: (message: MessageEnvelope) => Promise<void>) => { consume = next; return Promise.resolve(); } };
    const runtime = new AgentRuntime({ destination: "shiro", defaultOutputDestination: "discord", queue: oneShotQueue, harness: { run }, persistence, experienceIntegration: { enqueue }, ids: new SequenceIdGenerator(["event-peer-direct"]), now: () => new Date("2026-11-21T00:00:00.000Z") });
    await runtime.start(new AbortController().signal);
    await consume?.({ ...observed, id: "message-peer-direct-closure", payload: { ...observed.payload, text: "こちらこそ。それではまた", addressing: "direct" } });
    expect(run).toHaveBeenCalledTimes(1);
    expect(persistence.events).toHaveLength(1);
    expect(persistence.ignoredObservations).toHaveLength(0);
    expect(await persistence.pendingOutbox(10)).toEqual([]);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.sourceEvent.payload).toMatchObject({ senderKind: "peer", addressing: "direct" });
    expect(enqueued[0]?.result.output.action).toEqual({ type: "no-external-action", reason: "新しい問いや対象がなく、会話目的は満たされた" });
  });

  it("FR-76, FR-88, FR-90: keeps mention delivery when a direct peer brings a new question", async () => {
    const persistence = new InMemoryRuntimePersistence((event) => { const input = agentCoreInputFixture(); input.run.eventId = event.id; input.run.agentId = event.agentId; input.currentSelf.agentId = event.agentId; input.state.agentId = event.agentId; return input; });
    const run = vi.fn(() => Promise.resolve({ output: { desire: "akaの新しい問いへ、自分の仮説を返す", action: { type: "respond" as const, content: "その差は測定方法の違いかもしれない。" } }, toolExecutions: [] }));
    const enqueued: Omit<ExperienceIntegrationInput, "integrationId">[] = [];
    const enqueue = (input: Omit<ExperienceIntegrationInput, "integrationId">): Promise<void> => { enqueued.push(input); return Promise.resolve(); };
    let consume: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const oneShotQueue = { publish: () => Promise.resolve(), subscribe: (_destination: string, next: (message: MessageEnvelope) => Promise<void>) => { consume = next; return Promise.resolve(); } };
    const runtime = new AgentRuntime({ destination: "shiro", defaultOutputDestination: "discord", queue: oneShotQueue, harness: { run }, persistence, experienceIntegration: { enqueue }, ids: new SequenceIdGenerator(["event-peer-direct-question", "outbox-peer-direct-question"]), now: () => new Date("2026-11-21T00:00:00.000Z") });
    await runtime.start(new AbortController().signal);
    await consume?.({ ...observed, id: "message-peer-direct-question", hop: 2, payload: { ...observed.payload, text: "その差は何が原因だと思う？", addressing: "direct" } });
    const pending = await persistence.pendingOutbox(10);
    expect(run).toHaveBeenCalledTimes(1);
    expect(persistence.ignoredObservations).toHaveLength(0);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.envelope).toMatchObject({ destination: "discord", hop: 3, payload: { type: "agent-response", text: "その差は測定方法の違いかもしれない。", peer: { discordUserId: "discord-aka" } } });
    expect(enqueued).toHaveLength(1);
  });

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
