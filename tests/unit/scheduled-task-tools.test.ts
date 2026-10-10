import type { Pool } from "pg";

import { ToolRegistry } from "../../src/application/tool-registry.js";
import { createScheduledTaskTools } from "../../src/infrastructure/tools/scheduled-task-tools.js";
import { SequenceIdGenerator } from "../../src/infrastructure/system.js";

describe("Scheduled Task tools", () => {
  it("creates a reservation without executing its instruction and reuses the idempotency key", async () => {
    const queries: { text: string; values: readonly unknown[] }[] = [];
    const pool = { query: (text: string, values: readonly unknown[]) => { queries.push({ text, values }); return Promise.resolve({ rows: [{ id: "task-1", execute_at: new Date("2026-01-02T00:00:00Z"), instruction: "結果を知らせる", reason: null, destination: "terminal", status: "scheduled", attempt: 0 }] }); } } as unknown as Pool;
    const registry = new ToolRegistry(createScheduledTaskTools(pool, new SequenceIdGenerator(["task-1", "unused"]), () => new Date("2026-01-01T00:00:00Z")));
    const context = { agentId: "agent-a", runId: "run-1", eventId: "event-1", idempotencyKey: "run-1:call-1" };
    const input = { executeAt: "2026-01-02T00:00:00Z", instruction: "結果を知らせる", destination: "terminal" };
    await expect(registry.execute("schedule_task", input, context, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { id: "task-1", status: "scheduled" } });
    await registry.execute("schedule_task", input, context, new AbortController().signal);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.text).toContain("INSERT INTO scheduled_tasks");
    expect(queries[0]?.values).toContain("結果を知らせる");
  });

  it("rejects a past execution time", async () => {
    const pool = { query: () => { throw new Error("must not query"); } } as unknown as Pool;
    const registry = new ToolRegistry(createScheduledTaskTools(pool, new SequenceIdGenerator(["task-1"]), () => new Date("2026-01-02T00:00:00Z")));
    await expect(registry.execute("schedule_task", { executeAt: "2026-01-01T00:00:00Z", instruction: "old" }, { agentId: "agent-a", runId: "run-1", eventId: "event-1", idempotencyKey: "key" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
