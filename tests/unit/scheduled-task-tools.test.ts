import type { Pool } from "pg";

import { ToolRegistry } from "../../src/application/tool-registry.js";
import { createScheduledTaskTools } from "../../src/infrastructure/tools/scheduled-task-tools.js";
import { SequenceIdGenerator } from "../../src/infrastructure/system.js";

describe("Scheduled Task tools", () => {
  it("FR-40: describes the task fields without duplicating execution rules", () => {
    const pool = { query: () => { throw new Error("must not query"); } } as unknown as Pool;
    const definitions = new ToolRegistry(createScheduledTaskTools(pool, new SequenceIdGenerator([]), () => new Date("2026-01-01T00:00:00Z"))).definitions();
    const create = definitions.find(({ name }) => name === "schedule_task");
    const update = definitions.find(({ name }) => name === "scheduled_task_update");
    const properties = create?.inputSchema.properties as Record<string, { description?: string; maxLength?: number }> | undefined;
    const updateProperties = update?.inputSchema.properties as Record<string, { description?: string; maxLength?: number }> | undefined;

    expect(create?.description).toBe("指定した将来時刻に一度だけ実行する仕事を予約する。予約時には実行しない。");
    expect(properties?.["executeAt"]?.description).toBe("実行する将来のISO 8601日時");
    expect(properties?.["instruction"]).toMatchObject({
      description: "期限到来時に実行する仕事だけを1〜2文で書く。必要なら対象、参照する情報、期待する結果を含める。実行日時、予約理由、送信先、Toolの使い方、共通動作規則は書かない",
      maxLength: 1_000
    });
    expect(properties?.["reason"]?.description).toBe("この実行を予約する理由。期限到来時の作業手順は書かない");
    expect(properties?.["destination"]?.description).toBe("結果の明示的な配送先。通常は省略する");
    expect(updateProperties?.["instruction"]).toMatchObject(properties?.["instruction"] ?? {});
    expect(updateProperties?.["reason"]?.description).toBe(properties?.["reason"]?.description);
    expect(updateProperties?.["destination"]?.description).toBe(properties?.["destination"]?.description);
  });

  it("FR-40: creates a reservation without executing its instruction and reuses the idempotency key", async () => {
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

  it("FR-40: rejects a past execution time", async () => {
    const pool = { query: () => { throw new Error("must not query"); } } as unknown as Pool;
    const registry = new ToolRegistry(createScheduledTaskTools(pool, new SequenceIdGenerator(["task-1"]), () => new Date("2026-01-02T00:00:00Z")));
    await expect(registry.execute("schedule_task", { executeAt: "2026-01-01T00:00:00Z", instruction: "old" }, { agentId: "agent-a", runId: "run-1", eventId: "event-1", idempotencyKey: "key" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("FR-40: accepts a 1,000 character instruction and rejects a 1,001 character instruction", async () => {
    const pool = { query: () => Promise.resolve({ rows: [{ id: "task-1", execute_at: new Date("2026-01-02T00:00:00Z"), instruction: "a".repeat(1_000), reason: null, destination: null, status: "scheduled", attempt: 0 }] }) } as unknown as Pool;
    const registry = new ToolRegistry(createScheduledTaskTools(pool, new SequenceIdGenerator(["task-1"]), () => new Date("2026-01-01T00:00:00Z")));
    const context = { agentId: "agent-a", runId: "run-1", eventId: "event-1", idempotencyKey: "limit-create" };

    await expect(registry.execute("schedule_task", { executeAt: "2026-01-02T00:00:00Z", instruction: "a".repeat(1_000) }, context, new AbortController().signal)).resolves.toMatchObject({ ok: true });
    await expect(registry.execute("schedule_task", { executeAt: "2026-01-02T00:00:00Z", instruction: "a".repeat(1_001) }, { ...context, idempotencyKey: "over-limit-create" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("FR-40: updates only an owned scheduled Task and validates the requested change", async () => {
    const queries: { text: string; values: readonly unknown[] }[] = [];
    const pool = { query: (text: string, values: readonly unknown[]) => { queries.push({ text, values }); return Promise.resolve({ rows: [{ id: "task-1", execute_at: new Date("2026-01-03T00:00:00Z"), instruction: "更新後の指示", reason: null, destination: "terminal", status: "scheduled", attempt: 0 }] }); } } as unknown as Pool;
    const registry = new ToolRegistry(createScheduledTaskTools(pool, new SequenceIdGenerator([]), () => new Date("2026-01-01T00:00:00Z")));
    const context = { agentId: "agent-a", runId: "run-1", eventId: "event-1", idempotencyKey: "update-1" };
    await expect(registry.execute("scheduled_task_update", { taskId: "task-1", executeAt: "2026-01-03T00:00:00Z", instruction: "更新後の指示" }, context, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { id: "task-1", instruction: "更新後の指示" } });
    expect(queries[0]?.text).toContain("agent_id=$2 AND status='scheduled'");
    expect(queries[0]?.values.slice(0, 4)).toEqual(["task-1", "agent-a", "2026-01-03T00:00:00Z", "更新後の指示"]);
    await expect(registry.execute("scheduled_task_update", { taskId: "task-1" }, { ...context, idempotencyKey: "empty" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(registry.execute("scheduled_task_update", { taskId: "task-1", executeAt: "2025-01-01T00:00:00Z" }, { ...context, idempotencyKey: "past" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(registry.execute("scheduled_task_update", { taskId: "task-1", instruction: "a".repeat(1_001) }, { ...context, idempotencyKey: "over-limit-update" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
