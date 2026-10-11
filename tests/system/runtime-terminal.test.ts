import { AgentRuntime, OutboxDispatcher } from "../../src/application/agent-runtime.js";
import { RuntimeEventPublisher } from "../../src/application/runtime-event-publisher.js";
import { ScriptedAgentHarness } from "../../src/application/scripted-agent-harness.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { AddressedFileQueue } from "../../src/infrastructure/queue/addressed-file-queue.js";
import { TerminalAdapter } from "../../src/infrastructure/ui/terminal-adapter.js";
import { InMemoryRuntimePersistence } from "../../src/testing/in-memory-runtime-persistence.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";
import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";
import { messageFixture } from "../../src/testing/contract-fixtures.js";
import { createStdoutLogger } from "../../src/observability/logger.js";

const eventually = async (assertion: () => void): Promise<void> => { for (let attempt = 0; attempt < 200; attempt += 1) { try { assertion(); return; } catch (error) { if (attempt === 199) throw error; await new Promise((resolve) => setTimeout(resolve, 10)); } } };

describe("ST-01 Terminal round trip", () => {
  it("routes time and memory review through the normal autonomous decision", async () => {
    const clock = new FixedClock(new Date("2026-01-02T03:04:05Z"));
    const persistence = new InMemoryRuntimePersistence((event) => {
      const input = agentCoreInputFixture();
      input.run = { ...input.run, eventId: event.id, agentId: event.agentId };
      input.observation = { ...input.observation, eventId: event.id, content: event.payload };
      return input;
    });
    let harnessCalls = 0;
    const runtime = new AgentRuntime({
      destination: "agent-a",
      defaultOutputDestination: "terminal",
      queue: { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() },
      harness: { run: () => { harnessCalls += 1; return Promise.resolve({ output: { interpretation: { activeMotive: { description: "状態を再評価する", evidenceIds: ["state-review-event"] } }, internalChanges: { immediateStateUpdates: [] }, action: { type: "notify-no-execution", content: "今は別の手掛かりが増えるまで保留する", reason: "今は外部行動が不要" } }, toolExecutions: [] }); } },
      persistence,
      ids: new SequenceIdGenerator(["autonomous-notification"]),
      now: () => clock.now()
    });
    const action = await runtime.process({ id: "state-review-event", agentId: "agent-a", kind: "internal", occurredAt: clock.now().toISOString(), payload: { targetKind: "state-review", schedulerGenerated: true, reason: "Review persistent state", destination: "terminal" } }, new AbortController().signal);
    expect(action).toEqual({ type: "notify-no-execution", content: "今は別の手掛かりが増えるまで保留する", reason: "今は外部行動が不要" });
    expect(harnessCalls).toBe(1);
    expect(persistence.events).toHaveLength(1);
    await expect(persistence.claimPostProcess("agent-a", "run-1", "experience-integration")).resolves.toBeUndefined();
    await expect(persistence.claimPostProcess("agent-a", "run-1", "memory")).resolves.toBeUndefined();
  });

  it("does not mark an autonomous Event successful without a destination", async () => {
    const persistence = new InMemoryRuntimePersistence(() => agentCoreInputFixture());
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "", queue: { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() }, harness: new ScriptedAgentHarness([]), persistence, ids: new SequenceIdGenerator([]), now: () => new Date("2026-01-01T00:00:00Z") });
    await expect(runtime.process({ id: "autonomous-event", agentId: "agent-a", kind: "internal", occurredAt: "2026-01-01T00:00:00Z", payload: { targetKind: "idle" } }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    expect(persistence.events).toHaveLength(0);
  });

  it("continues a conversation, commits once, dispatches outbox, and drains", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const clock = new FixedClock(new Date("2026-01-01T00:00:00Z"));
    const queue = new AddressedFileQueue(root, { now: () => clock.now() });
    const terminal = new TerminalAdapter(queue, clock, new SequenceIdGenerator(["input-1", "input-2"]));
    const persistence = new InMemoryRuntimePersistence((event) => { const input = agentCoreInputFixture(); input.run.eventId = event.id; input.run.agentId = event.agentId; input.observation.eventId = event.id; return input; });
    const harness = new ScriptedAgentHarness([
      { interpretation: { activeMotive: { description: "respond to this event", evidenceIds: ["event-1"] } }, internalChanges: { immediateStateUpdates: [{ target: "emotion", operation: "set", value: "Engaged", reason: "Conversation", evidenceIds: [] }] }, action: { type: "respond", content: "First" } },
      { interpretation: { activeMotive: { description: "respond to this event", evidenceIds: ["event-1"] } }, internalChanges: { immediateStateUpdates: [] }, action: { type: "respond", content: "Second" } }
    ]);
    const logLines: string[] = []; const logger = createStdoutLogger({ botId: "agent-a" }, (line) => { logLines.push(line); }, () => clock.now());
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue, harness, persistence, ids: new SequenceIdGenerator(["event-1", "output-1", "event-2", "output-2"]), logger, now: () => clock.now() });
    const controller = new AbortController(); const responses: string[] = [];
    const running = runtime.start(controller.signal); const receiving = terminal.receive((message) => { responses.push(message.text); return Promise.resolve(); }, controller.signal);
    const dispatcher = new OutboxDispatcher(persistence, queue, logger);
    await terminal.send("agent-a", "hello"); await eventually(() => { expect(persistence.events).toHaveLength(1); }); await dispatcher.dispatch(); await eventually(() => { expect(responses).toEqual(["First"]); });
    await queue.publish(messageFixture({ id: "input-1", destination: "agent-a", replyTo: "terminal", sentAt: "2026-01-01T00:00:00.000Z", availableAt: "2026-01-01T00:00:00.000Z", expiresAt: "2026-01-02T00:00:00.000Z", payload: { type: "user-message", text: "hello" } }));
    await new Promise((resolve) => setTimeout(resolve, 50)); expect(persistence.events).toHaveLength(1);
    await terminal.send("agent-a", "again"); await eventually(() => { expect(persistence.events).toHaveLength(2); }); await dispatcher.dispatch(); await eventually(() => { expect(responses).toEqual(["First", "Second"]); });
    expect(persistence.updates[0]?.changes[0]?.target).toBe("emotion");
    const steps = logLines.map((line) => (JSON.parse(line) as { step: string }).step); expect(steps).toEqual(expect.arrayContaining(["message.received", "event.created", "context.loading", "context.loaded", "agent_core.started", "agent_core.completed", "event.committed", "outbox.delivery_started", "outbox.delivery_completed"]));
    controller.abort(); await Promise.all([running, receiving]); await runtime.drain(); await scope.close();
  });

  it("does not publish or mark an outbox record when publish fails", async () => {
    const persistence = new InMemoryRuntimePersistence(() => agentCoreInputFixture());
    const message = { id: "out", destination: "terminal", source: "agent-a", sentAt: "2026-01-01T00:00:00Z", availableAt: "2026-01-01T00:00:00Z", expiresAt: "2026-01-02T00:00:00Z", attempt: 0, hop: 0, payload: {} };
    await persistence.commit(message, { id: "e", agentId: "agent-a", kind: "internal", occurredAt: "2026-01-01T00:00:00Z", payload: {} }, agentCoreInputFixture(), { output: { interpretation: { activeMotive: { description: "respond to this event", evidenceIds: ["event-1"] } }, internalChanges: { immediateStateUpdates: [] }, action: { type: "no-external-action", reason: "test" } }, toolExecutions: [] }, { state: agentCoreInputFixture().dynamicState, changes: [] }, [message]);
    const queue = { publish: () => Promise.reject(new Error("down")), subscribe: () => Promise.resolve() };
    await expect(new OutboxDispatcher(persistence, queue).dispatch()).rejects.toThrow("down");
    expect(await persistence.pendingOutbox(10)).toHaveLength(1);
  });

  it("accepts External, Time and System Events through the production queue contract", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const clock = new FixedClock(new Date("2026-01-01T00:00:00Z")); const queue = new AddressedFileQueue(root, { now: () => clock.now() });
    const persistence = new InMemoryRuntimePersistence((event) => { const input = agentCoreInputFixture(); input.run.eventId = event.id; input.run.agentId = event.agentId; input.observation.eventId = event.id; return input; });
    const noAction = { interpretation: { activeMotive: { description: "respond to this event", evidenceIds: ["event-1"] } }, internalChanges: { immediateStateUpdates: [] }, action: { type: "no-external-action" as const, reason: "Observed" } };
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue, harness: new ScriptedAgentHarness([noAction, noAction, noAction]), persistence, ids: new SequenceIdGenerator(["external-domain-event", "time-domain-event", "system-domain-event"]), now: () => clock.now() });
    const publisher = new RuntimeEventPublisher(queue, clock, new SequenceIdGenerator(["external-message", "time-message", "system-message"])); const controller = new AbortController(); const running = runtime.start(controller.signal);
    await publisher.publishExternal("agent-a", { text: "A build completed", sourceId: "ci", facts: ["status=success"], resultOfActionId: "prior-run", correlationId: "conversation" });
    await publisher.publishTime("agent-a", "Daily review", new Date("2026-01-01T01:00:00Z"));
    await publisher.publishSystem("agent-a", "Permissions changed", { capability: "web_list" });
    await eventually(() => { expect(persistence.events).toHaveLength(3); });
    const eventsByKind = new Map(persistence.events.map((event) => [event.kind, event]));
    expect([...eventsByKind.keys()].sort()).toEqual(["external", "system", "time"]);
    expect(eventsByKind.get("external")?.payload.facts).toEqual(["status=success"]);
    expect(eventsByKind.get("external")).toMatchObject({ causationId: "prior-run", correlationId: "conversation" });
    expect(eventsByKind.get("time")?.occurredAt).toBe("2026-01-01T01:00:00.000Z");
    controller.abort(); await running; await runtime.drain(); await scope.close();
  });
});

describe("autonomous response outbox", () => {
  it("retains an autonomous response across delivery failure with its routing context", async () => {
    const input = agentCoreInputFixture();
    const persistence = new InMemoryRuntimePersistence(() => input);
    const queue = { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() };
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue, persistence, ids: new SequenceIdGenerator(["autonomous-output"]), now: () => new Date("2026-01-01T00:00:00Z"), harness: new ScriptedAgentHarness([{ interpretation: { activeMotive: { description: "share", evidenceIds: ["event-1"] } }, internalChanges: { immediateStateUpdates: [] }, action: { type: "respond", content: "発見を共有する" } }]) });
    await runtime.process({ id: "autonomous-event", agentId: "agent-a", kind: "internal", occurredAt: "2026-01-01T00:00:00Z", payload: { targetKind: "autonomy-review", destination: "discord", replyContext: { channelId: "channel" } } }, new AbortController().signal);
    const pending = await persistence.pendingOutbox(10);
    expect(pending).toHaveLength(1);
    expect(pending[0]?.envelope).toMatchObject({ id: "autonomous-output", destination: "discord", correlationId: "autonomous-event", causationId: input.run.runId, payload: { autonomous: true, replyContext: { channelId: "channel" } } });
    await expect(new OutboxDispatcher(persistence, { ...queue, publish: () => Promise.reject(new Error("offline")) }).dispatch()).rejects.toThrow("offline");
    expect(await persistence.pendingOutbox(10)).toHaveLength(1);
    expect(await new OutboxDispatcher(persistence, queue).dispatch()).toBe(1);
    expect(await new OutboxDispatcher(persistence, queue).dispatch()).toBe(0);
  });

  it.each([
    ["autonomy-review", "internal"],
    ["scheduled-task", "system"]
  ] as const)("delivers a refusal for %s without exposing its internal reason", async (targetKind, kind) => {
    const input = agentCoreInputFixture();
    const persistence = new InMemoryRuntimePersistence(() => input);
    const queue = { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() };
    const refusal = { interpretation: { activeMotive: { description: "decline", evidenceIds: ["event-1"] } }, internalChanges: { immediateStateUpdates: [] }, action: { type: "refuse" as const, content: "今回は引き受けられません。", reason: "価値観に反する", basis: "personality" as const } };
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue, persistence, ids: new SequenceIdGenerator([`${targetKind}-output`]), now: () => new Date("2026-01-01T00:00:00Z"), harness: new ScriptedAgentHarness([refusal]) });
    await runtime.process({ id: `${targetKind}-event`, agentId: "agent-a", kind, occurredAt: "2026-01-01T00:00:00Z", payload: { targetKind, destination: "terminal" } }, new AbortController().signal);
    const [pending] = await persistence.pendingOutbox(10);
    expect(pending?.envelope.payload).toMatchObject({ text: "今回は引き受けられません。", action: { type: "refuse" } });
    expect(JSON.stringify(pending?.envelope.payload)).not.toContain("価値観に反する");
  });
});
