import { Scheduler } from "../../src/application/scheduler.js";
import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";

describe("ST-04 Internal Event", () => {
  it("runs directly without placing the trigger on the external queue", async () => {
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); let runtimeCalls = 0; let publishes = 0;
    const scheduler = new Scheduler({ repository: { claimDue: () => Promise.resolve([{ id: "i", agentId: "a", kind: "intention", reason: "due" }]), complete: () => Promise.resolve(), release: () => Promise.resolve() }, runtime: { process: (event) => { runtimeCalls += 1; expect(event.kind).toBe("internal"); return Promise.resolve({ type: "no-action", reason: "done" }); } }, queue: { publish: () => { publishes += 1; return Promise.resolve(); }, subscribe: () => Promise.resolve() }, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator(["event"]), lifecycle, defaultDestination: () => "terminal", reviewIntervalMs: 1_000 });
    await scheduler.tick(new AbortController().signal); expect(runtimeCalls).toBe(1); expect(publishes).toBe(0);
  });
});
