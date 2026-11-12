import type { IncomingMessage, Server, ServerResponse } from "node:http";

import { DebugUiRepository, type SqlQuery } from "../../src/debug-ui/repository.js";
import { createDebugUiServer } from "../../src/debug-ui/server.js";

async function request(server: Server, url: string): Promise<{ readonly status: number; readonly headers: Readonly<Record<string, string>>; readonly body: string }> {
  return new Promise((resolve) => {
    let status = 200; let headers: Readonly<Record<string, string>> = {};
    const response = {
      writeHead(nextStatus: number, nextHeaders: Readonly<Record<string, string>> = {}) { status = nextStatus; headers = nextHeaders; return this; },
      end(body: string = "") { resolve({ status, headers, body }); return this; }
    } as unknown as ServerResponse;
    server.emit("request", { method: "GET", url } as IncomingMessage, response);
  });
}

describe("Agent Debug UI", () => {
  it("NFR-12: uses only bounded SELECT queries and keeps Agent ownership filters", async () => {
    const calls: { sql: string; values: readonly unknown[] }[] = [];
    const query: SqlQuery = <T>(sql: string, values: readonly unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.includes("FROM agents a JOIN")) return Promise.resolve([{ id: "ao" }] as T[]);
      if (sql.includes("FROM agent_states WHERE")) return Promise.resolve([{ mood: "calm" }] as T[]);
      return Promise.resolve([]);
    };
    const repository = new DebugUiRepository(query);
    const overview = await repository.getOverview("ao");
    await repository.listRuns("ao", 999);
    await repository.listMemories("ao", 0);
    expect(calls.every(({ sql }) => /^SELECT\b/u.test(sql.trim()))).toBe(true);
    expect(calls.filter(({ values }) => values[0] === "ao")).toHaveLength(9);
    expect(calls.find(({ sql }) => sql.includes("FROM reflection_attempts"))?.values).toEqual(["ao"]);
    expect(calls.find(({ sql }) => sql.includes("FROM concern_activities"))?.values).toEqual(["ao"]);
    expect(calls.find(({ sql }) => sql.includes("FROM scheduled_tasks"))?.values).toEqual(["ao"]);
    expect(calls.find(({ sql }) => sql.includes("FROM autonomous_schedules"))?.sql).not.toContain("exploration_mode");
    expect(calls.find(({ sql }) => sql.includes("FROM autonomous_schedules"))?.sql).not.toContain("exploration_cursor");
    expect(calls.find(({ sql, values }) => sql.includes("FROM agent_runs") && values.length === 2)?.values).toEqual(["ao", 100]);
    expect(calls.find(({ sql, values }) => sql.includes("FROM agent_runs") && values.length === 2)?.sql).toContain("e.observation#>>'{content,targetKind}'");
    expect(overview?.state).toEqual({ mood: "calm" });
    expect(calls.find(({ sql }) => sql.includes("FROM memories"))?.values).toEqual(["ao", 1]);
  });

  it("NFR-12: scopes Event trace and trace-gap reads to the selected Agent", async () => {
    const calls: { sql: string; values: readonly unknown[] }[] = [];
    const query: SqlQuery = <T>(sql: string, values: readonly unknown[] = []) => {
      calls.push({ sql, values });
      if (sql.includes("FROM events WHERE agent_id=$1 AND id=$2")) return Promise.resolve([{ id: "event-1" }] as T[]);
      if (sql.includes("FROM agent_runs WHERE agent_id=$1 AND event_id=$2")) return Promise.resolve([{ id: "run-1" }] as T[]);
      return Promise.resolve([]);
    };
    const repository = new DebugUiRepository(query);
    await repository.listEvents("ao", 999);
    await repository.getEventTrace("ao", "event-1");
    await repository.listTraceGaps("ao", 0);
    expect(calls.every(({ sql }) => /^SELECT\b/u.test(sql.trim()))).toBe(true);
    expect(calls.find(({ sql }) => sql.includes("FROM events e LEFT JOIN LATERAL"))?.values).toEqual(["ao", 100]);
    expect(calls.find(({ sql }) => sql.includes("FROM events e LEFT JOIN LATERAL"))?.sql).toContain("e.kind<>'tool-result'");
    expect(calls.find(({ sql }) => sql.includes("FROM memory_mutations m LEFT JOIN events"))?.values).toEqual(["ao", 1]);
    expect(calls.filter(({ sql }) => sql.includes("FROM agent_runs WHERE agent_id=$1 AND event_id=$2"))[0]?.values).toEqual(["ao", "event-1"]);
    expect(calls.find(({ sql }) => sql.includes("FROM tool_executions"))?.sql).toContain("error IS NULL AS ok");
    expect(calls.find(({ sql }) => sql.includes("FROM prediction_evaluations pe JOIN prediction_records"))?.values).toEqual(["ao", "event-1"]);
    expect(calls.find(({ sql }) => sql.includes("e.causation_id=$2"))?.sql).toContain("e.kind<>'tool-result'");
    expect(calls.filter(({ sql }) => sql.includes("source_event_id=$2")).every(({ values }) => values[0] === "ao" && values[1] === "event-1")).toBe(true);
  });

  it("NFR-12: serves overview and returns 404 for an unknown Run", async () => {
    const repository = {
      listAgents: () => Promise.resolve([{ id: "ao", identity: "アオ", familyId: "social-agents", active: true, stateUpdatedAt: null }]),
      getOverview: () => Promise.resolve({ agent: { id: "ao" }, state: {}, scheduledTasks: [], schedules: [], reflections: [] }),
      listRuns: () => Promise.resolve([]), getRun: () => Promise.resolve(undefined), listMemories: () => Promise.resolve([])
    } as unknown as DebugUiRepository;
    const server = createDebugUiServer(repository);
    expect(JSON.parse((await request(server, "/api/agents")).body)).toEqual([{ id: "ao", identity: "アオ", familyId: "social-agents", active: true, stateUpdatedAt: null }]);
    expect((await request(server, "/api/agents/ao/runs/missing")).status).toBe(404);
    expect((await request(server, "/")).headers["content-type"]).toContain("text/html");
    server.close();
  });

  it("NFR-12: ships browser-side HTML escaping before rendering database values", async () => {
    const repository = { listAgents: () => Promise.resolve([]), getOverview: () => Promise.resolve(undefined), listRuns: () => Promise.resolve([]), getRun: () => Promise.resolve(undefined), listMemories: () => Promise.resolve([]) } as unknown as DebugUiRepository;
    const server = createDebugUiServer(repository); const page = (await request(server, "/")).body;
    expect(page).toContain("function escapeHtml"); expect(page).toContain("function eventOf(item)"); expect(page).toContain("関心形成（concern-formation）"); expect(page).toContain("Eventの役割・Concern経路"); expect(page).toContain("explorationCandidates"); expect(page).toContain("sourceConcernId"); expect(page).toContain("item.kind==='internal'&&item.internalKind"); expect(page).toContain("判断入力（Run開始時の保存断面）"); expect(page).toContain("function inputSummary(snapshot)"); expect(page).toContain("function toolActivity(item)"); expect(page).toContain("explorationMode"); expect(page).toContain("function followingSummary(detail)"); expect(page).toContain("predictionEvaluations"); expect(page).toContain("experienceIntegrations"); expect(page).toContain("Core後の処理（Integration・配送・予測・派生Event）"); expect(page).toContain("詳細を表示"); expect(page).toContain("State・Concern・Memory の変更"); expect(page).toContain("モデルの内部思考過程"); expect(page).toContain("overview.state"); expect(page).toContain("overview.reflections"); expect(page).toContain("function reflectionView(item)"); expect(page).toContain("executedAt:item.createdAt"); expect(page).toContain("detail.derivedEvents"); expect(page).toContain("timeZone:'Asia/Tokyo'"); expect(page).toContain("const jst=value=>"); expect(page).toContain("String(value??'—').replace"); expect(page).toContain("JSON.stringify(display(value),null,2)??'—'"); expect(page).toContain("'&lt;'"); expect(page).not.toContain("MutationObserver"); expect(page).not.toContain("setInterval"); server.close();
  });

  it("NFR-12: serves an Event timeline and trace, including Events without a Run", async () => {
    const repository = {
      listAgents: () => Promise.resolve([]), getOverview: () => Promise.resolve(undefined), listRuns: () => Promise.resolve([]), getRun: () => Promise.resolve(undefined), listMemories: () => Promise.resolve([]),
      listEvents: () => Promise.resolve([{ id: "memory-update-event", kind: "internal", runId: null }]), listTraceGaps: () => Promise.resolve([{ id: "mutation-gap" }]),
      getEventTrace: (_agentId: string, eventId: string) => Promise.resolve(eventId === "memory-update-event" ? { event: { id: "memory-update-event" }, run: undefined, stateChanges: [], toolExecutions: [], memoryMutations: [{ id: "mutation-1" }], predictions: [], predictionEvaluations: [], g3Tasks: [], scheduledTasks: [], outbox: [], derivedEvents: [] } : undefined)
    } as unknown as DebugUiRepository;
    const server = createDebugUiServer(repository);
    expect(JSON.parse((await request(server, "/api/agents/ao/events")).body)).toEqual([{ id: "memory-update-event", kind: "internal", runId: null }]);
    expect(JSON.parse((await request(server, "/api/agents/ao/trace-gaps")).body)).toEqual([{ id: "mutation-gap" }]);
    expect(JSON.parse((await request(server, "/api/agents/ao/events/memory-update-event")).body)).toMatchObject({ event: { id: "memory-update-event" }, memoryMutations: [{ id: "mutation-1" }] });
    expect((await request(server, "/api/agents/ao/events/missing")).status).toBe(404);
    server.close();
  });

  it("NFR-12: serves prediction, memory-update, background and G3 views", async () => {
    const repository = {
      listAgents: () => Promise.resolve([]), getOverview: () => Promise.resolve(undefined), listRuns: () => Promise.resolve([]), getRun: () => Promise.resolve(undefined), listMemories: () => Promise.resolve([]),
      listPredictions: () => Promise.resolve([{ id: "prediction-1" }]), listMemoryUpdates: () => Promise.resolve([{ id: "mutation-1" }]), listBackgroundExperiences: () => Promise.resolve([{ id: "aka-exp-0001" }]), listG3Tasks: () => Promise.resolve([{ id: "g3-1" }])
    } as unknown as DebugUiRepository;
    const server = createDebugUiServer(repository);
    expect(JSON.parse((await request(server, "/api/agents/ao/predictions")).body)).toEqual([{ id: "prediction-1" }]);
    expect(JSON.parse((await request(server, "/api/agents/ao/memory-updates")).body)).toEqual([{ id: "mutation-1" }]);
    expect(JSON.parse((await request(server, "/api/agents/ao/background-experiences")).body)).toEqual([{ id: "aka-exp-0001" }]);
    expect(JSON.parse((await request(server, "/api/agents/ao/g3")).body)).toEqual([{ id: "g3-1" }]);
    server.close();
  });

  it("NFR-12: returns 500 without crashing when a repository query fails", async () => {
    const repository = { listAgents: () => Promise.reject(new Error("query failed")), getOverview: () => Promise.resolve(undefined), listRuns: () => Promise.resolve([]), getRun: () => Promise.resolve(undefined), listMemories: () => Promise.resolve([]), listPredictions: () => Promise.resolve([]), listMemoryUpdates: () => Promise.resolve([]), listBackgroundExperiences: () => Promise.resolve([]), listG3Tasks: () => Promise.resolve([]) } as unknown as DebugUiRepository;
    const server = createDebugUiServer(repository);
    const response = await request(server, "/api/agents");
    expect(response.status).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: "query failed" });
    server.close();
  });
});
