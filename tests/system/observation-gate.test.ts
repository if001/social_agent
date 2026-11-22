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
  it("FR-21, FR-76, FR-90: lets an engaged observed post end without a reply when its concrete motive is exhausted", async () => {
    const persistence = new InMemoryRuntimePersistence((event) => { const input = agentCoreInputFixture(); input.run.eventId = event.id; input.run.agentId = event.agentId; input.currentSelf.agentId = event.agentId; input.state.agentId = event.agentId; return input; });
    const run = vi.fn(() => Promise.resolve({ output: { desire: "二重タグ案は採用済みで、今は新しい問いを作らない", action: { type: "no-external-action" as const, reason: "採用と同意だけで、具体的な問い・訂正・次行為の変更・自発表現がない" } }, toolExecutions: [] }));
    const enqueued: Omit<ExperienceIntegrationInput, "integrationId">[] = [];
    const enqueue = (input: Omit<ExperienceIntegrationInput, "integrationId">): Promise<void> => { enqueued.push(input); return Promise.resolve(); };
    const gate = new ObservationGate({ load: () => Promise.resolve({ text: "二重タグ案を採用したい。23日は比べるだけですね", peerName: "aka", self: { disposition: "気まま", story: "自分の寄り道を優先する" }, mood: "落ち着いている", concerns: [], memories: [], recentSelfSpeech: "二重タグを付ければ23日は比べるだけになる" }) }, { decide: () => Promise.resolve({ decision: "engage" as const, reason: "共有した案の採用には認知価値がある" }) });
    let consume: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const oneShotQueue = { publish: () => Promise.resolve(), subscribe: (_destination: string, next: (message: MessageEnvelope) => Promise<void>) => { consume = next; return Promise.resolve(); } };
    const runtime = new AgentRuntime({ destination: "shiro", defaultOutputDestination: "discord", queue: oneShotQueue, harness: { run }, persistence, experienceIntegration: { enqueue }, observationGate: gate, ids: new SequenceIdGenerator(["event-peer-observed"]), now: () => new Date("2026-11-21T00:00:00.000Z") });
    await runtime.start(new AbortController().signal); await consume?.({ ...observed, id: "message-peer-observed-closure" });
    expect(run).toHaveBeenCalledTimes(1);
    expect(persistence.events).toHaveLength(1);
    expect(persistence.ignoredObservations).toHaveLength(0);
    expect(await persistence.pendingOutbox(10)).toEqual([]);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]?.sourceEvent.payload).toMatchObject({ senderKind: "peer", addressing: "observed" });
  });

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

  it("FR-76, FR-88, FR-90, FR-92: creates one mention delivery for an explicit natural-language peer recipient", async () => {
    const persistence = new InMemoryRuntimePersistence((event) => { const input = agentCoreInputFixture(); input.run.eventId = event.id; input.run.agentId = event.agentId; input.currentSelf.agentId = event.agentId; input.state.agentId = event.agentId; return input; });
    const run = vi.fn(() => Promise.resolve({ output: { desire: "akaの新しい問いへ、自分の仮説を返す", action: { type: "respond" as const, content: "その差は測定方法の違いかもしれない。", recipient: "アカ" } }, toolExecutions: [] }));
    const enqueued: Omit<ExperienceIntegrationInput, "integrationId">[] = [];
    const enqueue = (input: Omit<ExperienceIntegrationInput, "integrationId">): Promise<void> => { enqueued.push(input); return Promise.resolve(); };
    let consume: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const oneShotQueue = { publish: () => Promise.resolve(), subscribe: (_destination: string, next: (message: MessageEnvelope) => Promise<void>) => { consume = next; return Promise.resolve(); } };
    const runtime = new AgentRuntime({ destination: "shiro", defaultOutputDestination: "discord", queue: oneShotQueue, harness: { run }, persistence, experienceIntegration: { enqueue }, peers: [{ agentId: "aka", displayName: "アカ", discordUserId: "discord-aka", channelId: "channel" }], ids: new SequenceIdGenerator(["event-peer-direct-question", "outbox-peer-direct-question"]), now: () => new Date("2026-11-21T00:00:00.000Z") });
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

  it("FR-91, NFR-21: treats a failed observed-post Gate as an ignored audit record", async () => {
    const persistence = new InMemoryRuntimePersistence((event) => { const input = agentCoreInputFixture(); input.run.eventId = event.id; input.run.agentId = event.agentId; input.currentSelf.agentId = event.agentId; input.state.agentId = event.agentId; return input; });
    const run = vi.fn(() => Promise.resolve({ output: { desire: "should not run", action: { type: "respond" as const, content: "should not run" } }, toolExecutions: [] }));
    const gate = new ObservationGate({ load: () => Promise.reject(new Error("provider context unavailable")) }, { decide: () => Promise.resolve({ decision: "engage" as const, reason: "unused" }) });
    let consume: ((message: MessageEnvelope) => Promise<void>) | undefined;
    const oneShotQueue = { publish: () => Promise.resolve(), subscribe: (_destination: string, next: (message: MessageEnvelope) => Promise<void>) => { consume = next; return Promise.resolve(); } };
    const runtime = new AgentRuntime({ destination: "shiro", defaultOutputDestination: "discord", queue: oneShotQueue, harness: { run }, persistence, observationGate: gate, ids: new SequenceIdGenerator(["event-gate-failure"]), now: () => new Date("2026-11-21T00:00:00.000Z") });
    await runtime.start(new AbortController().signal); await consume?.({ ...observed, id: "message-gate-failure" });
    expect(run).not.toHaveBeenCalled();
    expect(persistence.ignoredObservations).toHaveLength(1);
    expect(persistence.ignoredObservations[0]?.gate).toMatchObject({ decision: "ignore", failureReason: "provider context unavailable" });
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
