import { Scheduler, type ScheduledTarget } from "../../src/application/scheduler.js";
import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";
import type { MessageEnvelope } from "../../src/domain/contracts.js";

describe("Scheduler", () => {
  const target: ScheduledTarget = { id: "intention-1", agentId: "agent-a", kind: "intention", reason: "Due" };
  const timings = { autonomyReviewIntervalMs: 60_000, stateReviewIntervalMs: 86_400_000, memoryRecallIntervalMs: 604_800_000, intentionReviewIntervalMs: 120_000, persistentDriveReviewIntervalMs: 3_600_000 };
  const setup = (action: { type: "no-action"; reason: string } | { type: "respond"; content: string } | { type: "wait"; reason: string; until?: string }, replyContext?: Readonly<Record<string, unknown>>) => {
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); const published: MessageEnvelope[] = []; let claimed = false; const completions: (Date | null)[] = [];
    const repository = { claimDue: () => { if (claimed) return Promise.resolve([]); claimed = true; return Promise.resolve([target]); }, complete: (_target: ScheduledTarget, next: Date | null) => { completions.push(next); return Promise.resolve(); }, release: () => Promise.resolve() };
    const scheduler = new Scheduler({ repository, runtime: { process: () => Promise.resolve(action) }, queue: { publish: (message) => { published.push(message); return Promise.resolve(); }, subscribe: () => Promise.resolve() }, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator(["event", "output"]), lifecycle, defaultDestination: () => "terminal", ...(replyContext === undefined ? {} : { defaultReplyContext: () => replyContext }), ...timings });
    return { scheduler, lifecycle, published, completions };
  };

  it("runs due targets once and does not queue internal events", async () => {
    const value = setup({ type: "no-action", reason: "Nothing needed" });
    await expect(value.scheduler.tick(new AbortController().signal)).resolves.toBe(1); await expect(value.scheduler.tick(new AbortController().signal)).resolves.toBe(0);
    expect(value.published).toEqual([]); expect(value.completions[0]?.toISOString()).toBe("2026-01-01T00:02:00.000Z");
  });
  it("publishes only externally visible actions to the default destination", async () => {
    const value = setup({ type: "respond", content: "An autonomous update" }, { channelId: "discord-channel" }); await value.scheduler.tick(new AbortController().signal);
    expect(value.published).toHaveLength(1); expect(value.published[0]).toMatchObject({ destination: "terminal", payload: { autonomous: true, replyContext: { channelId: "discord-channel" } } }); expect(value.completions[0]?.toISOString()).toBe("2026-01-01T00:02:00.000Z");
  });
  it("uses explicit wait time and starts no work while stopping", async () => {
    const value = setup({ type: "wait", reason: "Later", until: "2026-01-02T00:00:00Z" }); await value.scheduler.tick(new AbortController().signal); expect(value.completions[0]?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    const stopped = setup({ type: "no-action", reason: "No" }); stopped.lifecycle.transition("stopping"); await expect(stopped.scheduler.tick(new AbortController().signal)).resolves.toBe(0);
  });
  it("reschedules state review even when no state change is needed", async () => {
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); const completions: (Date | null)[] = [];
    const review: ScheduledTarget = { id: "state-review:agent-a", agentId: "agent-a", kind: "state-review", reason: "Review state" };
    const scheduler = new Scheduler({ repository: { claimDue: () => Promise.resolve([review]), complete: (_target, next) => { completions.push(next); return Promise.resolve(); }, release: () => Promise.resolve() }, runtime: { process: () => Promise.resolve({ type: "no-action", reason: "Keep current state" }) }, queue: { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() }, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator(["event"]), lifecycle, defaultDestination: () => "terminal", ...timings });
    await scheduler.tick(new AbortController().signal);
    expect(completions[0]?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
  });
  it("reschedules memory recall at its lower frequency", async () => {
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); const completions: (Date | null)[] = [];
    const recall: ScheduledTarget = { id: "memory-recall:agent-a", agentId: "agent-a", kind: "memory-recall", reason: "Recall" };
    const scheduler = new Scheduler({ repository: { claimDue: () => Promise.resolve([recall]), complete: (_target, next) => { completions.push(next); return Promise.resolve(); }, release: () => Promise.resolve() }, runtime: { process: () => Promise.resolve({ type: "no-action", reason: "Nothing relevant" }) }, queue: { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() }, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator(["event"]), lifecycle, defaultDestination: () => "terminal", ...timings });
    await scheduler.tick(new AbortController().signal);
    expect(completions[0]?.toISOString()).toBe("2026-01-08T00:00:00.000Z");
  });
  it("uses the persistent Drive interval independently", async () => {
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); const completions: (Date | null)[] = [];
    const drive: ScheduledTarget = { id: "drive:agent-a:learn", agentId: "agent-a", kind: "persistent-drive", reason: "Learn" };
    const scheduler = new Scheduler({ repository: { claimDue: () => Promise.resolve([drive]), complete: (_target, next) => { completions.push(next); return Promise.resolve(); }, release: () => Promise.resolve() }, runtime: { process: () => Promise.resolve({ type: "no-action", reason: "Not now" }) }, queue: { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() }, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator(["event"]), lifecycle, defaultDestination: () => undefined, ...timings });
    await scheduler.tick(new AbortController().signal);
    expect(completions[0]?.toISOString()).toBe("2026-01-01T01:00:00.000Z");
  });
  it("runs bounded autonomy review without an Intention and suppresses delivery without a destination", async () => {
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); const events: unknown[] = []; const completions: (Date | null)[] = []; let publishes = 0;
    const review: ScheduledTarget = { id: "autonomy-review:agent-a", agentId: "agent-a", kind: "autonomy-review", reason: "Review Self, Drive, Interest, and Memory" };
    const scheduler = new Scheduler({ repository: { claimDue: () => Promise.resolve([review]), complete: (_target, next) => { completions.push(next); return Promise.resolve(); }, release: () => Promise.resolve() }, runtime: { process: (event) => { events.push(event); return Promise.resolve({ type: "respond", content: "Internal result" }); } }, queue: { publish: () => { publishes += 1; return Promise.resolve(); }, subscribe: () => Promise.resolve() }, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator(["event"]), lifecycle, defaultDestination: () => undefined, ...timings });
    await scheduler.tick(new AbortController().signal);
    expect(events).toHaveLength(1); expect(events[0]).toMatchObject({ payload: { targetKind: "autonomy-review", schedulerGenerated: true } });
    expect(publishes).toBe(0); expect(completions[0]?.toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });
});
