import { Scheduler, type ScheduledTarget } from "../../src/application/scheduler.js";
import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";
import type { MessageEnvelope } from "../../src/domain/contracts.js";

describe("Scheduler", () => {
  const target: ScheduledTarget = { id: "intention-1", agentId: "agent-a", kind: "intention", reason: "Due" };
  const setup = (action: { type: "no-action"; reason: string } | { type: "respond"; content: string } | { type: "wait"; reason: string; until?: string }) => {
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); const published: MessageEnvelope[] = []; let claimed = false; const completions: (Date | null)[] = [];
    const repository = { claimDue: () => { if (claimed) return Promise.resolve([]); claimed = true; return Promise.resolve([target]); }, complete: (_target: ScheduledTarget, next: Date | null) => { completions.push(next); return Promise.resolve(); }, release: () => Promise.resolve() };
    const scheduler = new Scheduler({ repository, runtime: { process: () => Promise.resolve(action) }, queue: { publish: (message) => { published.push(message); return Promise.resolve(); }, subscribe: () => Promise.resolve() }, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator(["event", "output"]), lifecycle, defaultDestination: () => "terminal", reviewIntervalMs: 60_000 });
    return { scheduler, lifecycle, published, completions };
  };

  it("runs due targets once and does not queue internal events", async () => {
    const value = setup({ type: "no-action", reason: "Nothing needed" });
    await expect(value.scheduler.tick(new AbortController().signal)).resolves.toBe(1); await expect(value.scheduler.tick(new AbortController().signal)).resolves.toBe(0);
    expect(value.published).toEqual([]); expect(value.completions).toEqual([null]);
  });
  it("publishes only externally visible actions to the default destination", async () => {
    const value = setup({ type: "respond", content: "An autonomous update" }); await value.scheduler.tick(new AbortController().signal);
    expect(value.published).toHaveLength(1); expect(value.published[0]?.destination).toBe("terminal"); expect(value.completions[0]?.toISOString()).toBe("2026-01-01T00:01:00.000Z");
  });
  it("uses explicit wait time and starts no work while stopping", async () => {
    const value = setup({ type: "wait", reason: "Later", until: "2026-01-02T00:00:00Z" }); await value.scheduler.tick(new AbortController().signal); expect(value.completions[0]?.toISOString()).toBe("2026-01-02T00:00:00.000Z");
    const stopped = setup({ type: "no-action", reason: "No" }); stopped.lifecycle.transition("stopping"); await expect(stopped.scheduler.tick(new AbortController().signal)).resolves.toBe(0);
  });
});
