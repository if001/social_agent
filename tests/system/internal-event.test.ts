import { Scheduler } from "../../src/application/scheduler.js";
import { ProcessLifecycle } from "../../src/bootstrap/lifecycle.js";
import { FixedClock, SequenceIdGenerator } from "../../src/infrastructure/system.js";
import { AgentEventRouter } from "../../src/application/agent-event-router.js";

describe("ST-04 Internal Event", () => {
  it("runs directly without placing the trigger on the external queue", async () => {
    const lifecycle = new ProcessLifecycle(); lifecycle.transition("ready"); let runtimeCalls = 0; let publishes = 0;
    const scheduler = new Scheduler({ repository: { claimDue: () => Promise.resolve([{ id: "autonomy-review:a", agentId: "a", kind: "autonomy-review", reason: "due" }]), complete: () => Promise.resolve(), release: () => Promise.resolve() }, runtime: { process: (event) => { runtimeCalls += 1; expect(event.kind).toBe("internal"); return Promise.resolve({ type: "no-external-action", reason: "done" }); } }, queue: { publish: () => { publishes += 1; return Promise.resolve(); }, subscribe: () => Promise.resolve() }, clock: new FixedClock(new Date("2026-01-01T00:00:00Z")), ids: new SequenceIdGenerator(["event"]), lifecycle, defaultDestination: () => "terminal", autonomyReviewIntervalMs: 1_000, stateReviewIntervalMs: 1_000, memoryRecallIntervalMs: 1_000 });
    await scheduler.tick(new AbortController().signal); expect(runtimeCalls).toBe(1); expect(publishes).toBe(0);
  });

  it("routes only long-term-review Events to the Review Core", async () => {
    const normalEvents: string[] = []; const reviewGroups: string[][] = [];
    const router = new AgentEventRouter({ process: (event) => { normalEvents.push(event.id); return Promise.resolve({ type: "no-external-action", reason: "normal" }); } }, { review: (ids) => { reviewGroups.push(typeof ids === "string" ? [ids] : [...ids]); return Promise.resolve({ decisions: [{ candidateId: "candidate-1", decision: "KEEP", reason: "More evidence needed" }] }); } });
    const signal = new AbortController().signal;
    await router.process({ id: "normal-event", agentId: "a", kind: "internal", occurredAt: "2026-01-01T00:00:00Z", payload: { targetKind: "autonomy-review", targetId: "autonomy-review:a" } }, signal);
    await router.process({ id: "review-event", agentId: "a", kind: "internal", occurredAt: "2026-01-01T00:00:00Z", payload: { targetKind: "long-term-review", candidateIds: ["candidate-1"] } }, signal);
    expect(normalEvents).toEqual(["normal-event"]);
    expect(reviewGroups).toEqual([["candidate-1"]]);
  });
});
