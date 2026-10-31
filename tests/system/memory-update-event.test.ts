import { describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "../../src/application/agent-runtime.js";
import type { MemoryUpdateHandler } from "../../src/application/memory-update.js";
import { InMemoryRuntimePersistence } from "../../src/testing/in-memory-runtime-persistence.js";
import { agentCoreInputFixture } from "../../src/testing/contract-fixtures.js";

describe("FR-58, FR-59, NFR-18, AC-13: memory-update Event", () => {
  it("FR-58, AC-13: applies the handler without running the AgentHarness", async () => {
    const persistence = new InMemoryRuntimePersistence((event) => { const value = agentCoreInputFixture(); value.run = { ...value.run, eventId: event.id, agentId: event.agentId }; value.observation = { ...value.observation, eventId: event.id, content: event.payload }; return value; });
    const handle = vi.fn(() => Promise.resolve([{ intentIndex: 0, result: { operation: "no-op" as const } }]));
    const harness = { run: vi.fn(() => Promise.reject(new Error("AgentHarness must not run for memory-update"))) };
    const runtime = new AgentRuntime({ destination: "agent-a", defaultOutputDestination: "terminal", queue: { publish: () => Promise.resolve(), subscribe: () => Promise.resolve() }, harness, persistence, ids: { next: () => `id-${String(Math.random())}` }, now: () => new Date("2026-10-31T00:00:00Z"), memoryUpdateHandler: { handle } as unknown as MemoryUpdateHandler });
    const action = await runtime.process({ id: "memory-update-event", agentId: "agent-a", kind: "internal", occurredAt: "2026-10-31T00:00:00Z", payload: { targetKind: "memory-update", intents: [] } }, new AbortController().signal);
    expect(action).toEqual({ type: "no-external-action", reason: "MemoryUpdate was applied without an Agent Action" });
    expect(handle).toHaveBeenCalledTimes(1);
    expect(harness.run).not.toHaveBeenCalled();
  });
});
