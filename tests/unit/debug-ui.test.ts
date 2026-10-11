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
  it("uses only bounded SELECT queries and keeps Agent ownership filters", async () => {
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
    expect(calls.filter(({ values }) => values[0] === "ao")).toHaveLength(7);
    expect(calls.find(({ sql }) => sql.includes("FROM scheduled_tasks"))?.values).toEqual(["ao"]);
    expect(calls.find(({ sql, values }) => sql.includes("FROM agent_runs") && values.length === 2)?.values).toEqual(["ao", 100]);
    expect(calls.find(({ sql, values }) => sql.includes("FROM agent_runs") && values.length === 2)?.sql).toContain("e.observation#>>'{content,targetKind}'");
    expect(overview?.state).toEqual({ mood: "calm" });
    expect(calls.find(({ sql }) => sql.includes("FROM memories"))?.values).toEqual(["ao", 1]);
  });

  it("serves overview and returns 404 for an unknown Run", async () => {
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

  it("ships browser-side HTML escaping before rendering database values", async () => {
    const repository = { listAgents: () => Promise.resolve([]), getOverview: () => Promise.resolve(undefined), listRuns: () => Promise.resolve([]), getRun: () => Promise.resolve(undefined), listMemories: () => Promise.resolve([]) } as unknown as DebugUiRepository;
    const server = createDebugUiServer(repository); const page = (await request(server, "/")).body;
    expect(page).toContain("function escapeHtml"); expect(page).toContain("function eventOf(run)"); expect(page).toContain("run.eventKind+' / '+run.internalKind"); expect(page).toContain("Concern"); expect(page).toContain("overview.state"); expect(page).toContain("overview.reflections"); expect(page).toContain("Event Assessment / Desire / Action / Patch"); expect(page).toContain("String(value??'—').replace"); expect(page).toContain("JSON.stringify(value,null,2)??'—'"); expect(page).toContain("'&lt;'"); expect(page).not.toContain("setInterval"); server.close();
  });
});
