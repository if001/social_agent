import { Scheduler, type ScheduledTarget } from "../../src/application/scheduler.js";
import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";
import type { DomainEvent } from "../../src/domain/contracts.js";

describe("Scheduler", () => {
  const target: ScheduledTarget = { id: "idle:agent-a", agentId: "agent-a", kind: "idle", reason: "Due", explorationMode: "deepen" };
  const timings = { autonomyReviewIntervalMs: 60_000, stateReviewIntervalMs: 86_400_000, memoryRecallIntervalMs: 604_800_000 };
  const setup = (action: { type: "no-external-action"; reason: string } | { type: "respond"; content: string }, replyContext?: Readonly<Record<string, unknown>>) => {
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); const events: DomainEvent[] = []; let claimed = false; const completions: (Date | null)[] = [];
    const repository = { claimDue: () => { if (claimed) return Promise.resolve([]); claimed = true; return Promise.resolve([target]); }, complete: (_target: ScheduledTarget, next: Date | null) => { completions.push(next); return Promise.resolve(); }, release: () => Promise.resolve() };
    const scheduler = new Scheduler({ repository, runtime: { process: (event) => { events.push(event); return Promise.resolve(action); } }, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator(["event", "output"]), lifecycle, defaultDestination: () => "terminal", ...(replyContext === undefined ? {} : { defaultReplyContext: () => replyContext }), ...timings });
    return { scheduler, lifecycle, events, completions };
  };

  it("runs due targets once and does not queue internal events", async () => {
    const value = setup({ type: "no-external-action", reason: "Nothing needed" });
    await expect(value.scheduler.tick(new AbortController().signal)).resolves.toBe(1); await expect(value.scheduler.tick(new AbortController().signal)).resolves.toBe(0);
    expect(value.completions[0]?.toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });
  it("passes the resolved destination and reply context to Runtime", async () => {
    const value = setup({ type: "respond", content: "An autonomous update" }, { channelId: "discord-channel" }); await value.scheduler.tick(new AbortController().signal);
    expect(value.events).toHaveLength(1); expect(value.events[0]).toMatchObject({ payload: { destination: "terminal", replyContext: { channelId: "discord-channel" } } }); expect(value.completions[0]?.toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });
  it("starts no work while stopping", async () => {
    const stopped = setup({ type: "no-external-action", reason: "No" }); stopped.lifecycle.transition("stopping"); await expect(stopped.scheduler.tick(new AbortController().signal)).resolves.toBe(0);
  });
  it("runs a bounded idle Event", async () => {
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); const events: unknown[] = []; const completions: (Date | null)[] = [];
    const review: ScheduledTarget = { id: "idle:agent-a", agentId: "agent-a", kind: "idle", reason: "No activity during the configured interval", explorationMode: "bridge" };
    const scheduler = new Scheduler({ repository: { claimDue: () => Promise.resolve([review]), complete: (_target, next) => { completions.push(next); return Promise.resolve(); }, release: () => Promise.resolve() }, runtime: { process: (event) => { events.push(event); return Promise.resolve({ type: "respond", content: "Internal result" }); } }, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator(["event"]), lifecycle, defaultDestination: () => undefined, ...timings });
    await scheduler.tick(new AbortController().signal);
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ payload: { targetKind: "idle", schedulerGenerated: true, explorationMode: "bridge" } });
    expect(completions[0]?.toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });
  it("consumes a due Concern without installing a fixed periodic schedule", async () => {
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); const completions: (Date | null)[] = [];
    const motive: ScheduledTarget = { id: "concern:concern-1", agentId: "agent-a", kind: "concern-due", reason: "未解決点を再検討する" };
    const scheduler = new Scheduler({ repository: { claimDue: () => Promise.resolve([motive]), complete: (_target, next) => { completions.push(next); return Promise.resolve(); }, release: () => Promise.resolve() }, runtime: { process: () => Promise.resolve({ type: "no-external-action", reason: "今は行動しない" }) }, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator(["event"]), lifecycle, defaultDestination: () => undefined, ...timings });
    await scheduler.tick(new AbortController().signal);
    expect(completions).toEqual([null]);
  });
  it("runs Reflection as maintenance without invoking the action Runtime", async () => {
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); let runtimeCalls = 0; const reflections: string[] = []; const completions: (Date | null)[] = [];
    const reflection: ScheduledTarget = { id: "reflection:agent-a", agentId: "agent-a", kind: "reflection", reason: "経験を統合する" };
    const scheduler = new Scheduler({ repository: { claimDue: () => Promise.resolve([reflection]), complete: (_target, next) => { completions.push(next); return Promise.resolve(); }, release: () => Promise.resolve() }, runtime: { process: () => { runtimeCalls += 1; return Promise.resolve({ type: "respond", content: "unexpected" }); } }, reflection: { process: (id) => { reflections.push(id); return Promise.resolve(undefined); } }, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator(["reflection-event"]), lifecycle, defaultDestination: () => "terminal", ...timings });
    await expect(scheduler.tick(new AbortController().signal)).resolves.toBe(1);
    expect(runtimeCalls).toBe(0); expect(reflections).toEqual(["reflection-event"]); expect(completions[0]?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
  it("executes a Scheduled Task only through a System Event", async () => {
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); const events: { kind: string; payload: Record<string, unknown> }[] = []; let completed = 0;
    const task: ScheduledTarget = { id: "task-1", agentId: "agent-a", kind: "scheduled-task", reason: "約束", instruction: "調査結果を知らせる", destination: "terminal" };
    const scheduler = new Scheduler({ repository: { claimDue: () => Promise.resolve([task]), complete: () => { completed += 1; return Promise.resolve(); }, release: () => Promise.resolve() }, runtime: { process: (event) => { events.push(event); return Promise.resolve({ type: "respond", content: "結果" }); } }, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator(["event"]), lifecycle, defaultDestination: () => "terminal", ...timings });
    await scheduler.tick(new AbortController().signal);
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ kind: "system", payload: { targetId: "task-1", targetKind: "scheduled-task", reason: "約束", schedulerGenerated: true, instruction: "調査結果を知らせる", destination: "terminal" } });
    expect(completed).toBe(1);
  });
});
