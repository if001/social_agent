import { ToolRegistry } from "../../src/application/tool-registry.js";
import { createScheduledTaskTools, type ScheduledTaskToolRepository } from "../../src/infrastructure/tools/scheduled-task-tools.js";
import { SequenceIdGenerator } from "../../src/infrastructure/system.js";

describe("Scheduled Task tools", () => {
  it("FR-40: describes the task fields without duplicating execution rules", () => {
    const repository = {} as ScheduledTaskToolRepository;
    const definitions = new ToolRegistry(createScheduledTaskTools(repository, new SequenceIdGenerator([]), () => new Date("2026-01-01T00:00:00Z"))).definitions();
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
    let calls = 0; const repository: ScheduledTaskToolRepository = { create: () => { calls += 1; return Promise.resolve({ id: "task-1", executeAt: new Date("2026-01-02T00:00:00Z"), instruction: "結果を知らせる", reason: null, destination: "terminal", status: "scheduled", attempt: 0 }); }, list: () => Promise.resolve([]), cancel: () => Promise.resolve(undefined), update: () => Promise.resolve(undefined) };
    const registry = new ToolRegistry(createScheduledTaskTools(repository, new SequenceIdGenerator(["task-1", "unused"]), () => new Date("2026-01-01T00:00:00Z")));
    const context = { agentId: "agent-a", runId: "run-1", eventId: "event-1", idempotencyKey: "run-1:call-1" };
    const input = { executeAt: "2026-01-02T00:00:00Z", instruction: "結果を知らせる", destination: "terminal" };
    await expect(registry.execute("schedule_task", input, context, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { id: "task-1", status: "scheduled" } });
    await registry.execute("schedule_task", input, context, new AbortController().signal);
    expect(calls).toBe(1);
  });

  it("FR-40: rejects a past execution time", async () => {
    const repository = {} as ScheduledTaskToolRepository;
    const registry = new ToolRegistry(createScheduledTaskTools(repository, new SequenceIdGenerator(["task-1"]), () => new Date("2026-01-02T00:00:00Z")));
    await expect(registry.execute("schedule_task", { executeAt: "2026-01-01T00:00:00Z", instruction: "old" }, { agentId: "agent-a", runId: "run-1", eventId: "event-1", idempotencyKey: "key" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("FR-40: accepts a 1,000 character instruction and rejects a 1,001 character instruction", async () => {
    const repository: ScheduledTaskToolRepository = { create: () => Promise.resolve({ id: "task-1", executeAt: new Date("2026-01-02T00:00:00Z"), instruction: "a".repeat(1_000), reason: null, destination: null, status: "scheduled", attempt: 0 }), list: () => Promise.resolve([]), cancel: () => Promise.resolve(undefined), update: () => Promise.resolve(undefined) };
    const registry = new ToolRegistry(createScheduledTaskTools(repository, new SequenceIdGenerator(["task-1"]), () => new Date("2026-01-01T00:00:00Z")));
    const context = { agentId: "agent-a", runId: "run-1", eventId: "event-1", idempotencyKey: "limit-create" };

    await expect(registry.execute("schedule_task", { executeAt: "2026-01-02T00:00:00Z", instruction: "a".repeat(1_000) }, context, new AbortController().signal)).resolves.toMatchObject({ ok: true });
    await expect(registry.execute("schedule_task", { executeAt: "2026-01-02T00:00:00Z", instruction: "a".repeat(1_001) }, { ...context, idempotencyKey: "over-limit-create" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("FR-40: updates only an owned scheduled Task and validates the requested change", async () => {
    const updates: unknown[] = []; const repository: ScheduledTaskToolRepository = { create: () => Promise.resolve(undefined), list: () => Promise.resolve([]), cancel: () => Promise.resolve(undefined), update: (_agentId, _taskId, input) => { updates.push(input); return Promise.resolve({ id: "task-1", executeAt: new Date("2026-01-03T00:00:00Z"), instruction: "更新後の指示", reason: null, destination: "terminal", status: "scheduled", attempt: 0 }); } };
    const registry = new ToolRegistry(createScheduledTaskTools(repository, new SequenceIdGenerator([]), () => new Date("2026-01-01T00:00:00Z")));
    const context = { agentId: "agent-a", runId: "run-1", eventId: "event-1", idempotencyKey: "update-1" };
    await expect(registry.execute("scheduled_task_update", { taskId: "task-1", executeAt: "2026-01-03T00:00:00Z", instruction: "更新後の指示" }, context, new AbortController().signal)).resolves.toMatchObject({ ok: true, value: { id: "task-1", instruction: "更新後の指示" } });
    expect(updates).toHaveLength(1);
    await expect(registry.execute("scheduled_task_update", { taskId: "task-1" }, { ...context, idempotencyKey: "empty" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(registry.execute("scheduled_task_update", { taskId: "task-1", executeAt: "2025-01-01T00:00:00Z" }, { ...context, idempotencyKey: "past" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(registry.execute("scheduled_task_update", { taskId: "task-1", instruction: "a".repeat(1_001) }, { ...context, idempotencyKey: "over-limit-update" }, new AbortController().signal)).rejects.toMatchObject({ code: "VALIDATION" });
  });
});
