import { Scheduler } from "../../src/application/scheduler.js";
import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { AgentEventRouter } from "../../src/application/agent-event-router.js";

describe("ST-04 Internal Event", () => {
  it("FR-39: runs directly without placing the trigger on the external queue", async () => {
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); let runtimeCalls = 0;
    const scheduler = new Scheduler({ repository: { claimDue: () => Promise.resolve([{ id: "idle:a", agentId: "a", kind: "idle", reason: "due" }]), complete: () => Promise.resolve(), release: () => Promise.resolve() }, runtime: { process: (event) => { runtimeCalls += 1; expect(event.kind).toBe("internal"); return Promise.resolve({ type: "no-external-action", reason: "done" }); } }, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator(["event"]), lifecycle, defaultDestination: () => "terminal", autonomyReviewIntervalMs: 1_000, stateReviewIntervalMs: 1_000, memoryRecallIntervalMs: 1_000 });
    await scheduler.tick(new AbortController().signal); expect(runtimeCalls).toBe(1);
  });

  it("FR-39: preserves the Event reason while routing every cognitive trigger through one runtime", async () => {
    const normalEvents: string[] = [];
    const router = new AgentEventRouter({ process: (event) => { normalEvents.push(`${String(event.payload.targetKind)}:${event.id}`); return Promise.resolve({ type: "no-external-action", reason: "normal" }); } });
    const signal = new AbortController().signal;
    await router.process({ id: "normal-event", agentId: "a", kind: "internal", occurredAt: "2026-01-01T00:00:00Z", payload: { targetKind: "autonomy-review", targetId: "autonomy-review:a" } }, signal);
    await router.process({ id: "concern-event", agentId: "a", kind: "internal", occurredAt: "2026-01-01T00:00:00Z", payload: { targetKind: "concern-due", targetId: "concern:c1" } }, signal);
    expect(normalEvents).toEqual(["autonomy-review:normal-event", "concern-due:concern-event"]);
  });
});
