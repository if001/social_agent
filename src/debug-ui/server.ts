import { createServer, type Server } from "node:http";

import type { DebugUiRepository } from "./repository.js";
import { debugPage } from "./page.js";

function json(value: unknown): string { return JSON.stringify(value); }
function limit(url: URL): number { const value = Number(url.searchParams.get("limit") ?? ""); return Number.isInteger(value) && value > 0 ? value : 50; }

export function createDebugUiServer(repository: DebugUiRepository): Server {
  return createServer((request, response) => {
    void (async () => {
      try {
        if (request.method !== "GET") { response.writeHead(405).end("Method Not Allowed"); return; }
        const url = new URL(request.url ?? "/", "http://localhost");
        if (url.pathname === "/") { response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" }).end(debugPage); return; }
        if (url.pathname === "/api/agents") { const value = await repository.listAgents(); response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(json(value)); return; }
        const parts = url.pathname.split("/").filter(Boolean).map(decodeURIComponent);
        if (parts[0] !== "api" || parts[1] !== "agents" || parts[2] === undefined) { response.writeHead(404).end("Not Found"); return; }
        const agentId = parts[2];
        if (parts.length === 3) { const value = await repository.getOverview(agentId); if (value === undefined) response.writeHead(404).end("Agent Not Found"); else response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(json(value)); return; }
        if (parts[3] === "runs" && parts.length === 4) { const value = await repository.listRuns(agentId, limit(url)); response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(json(value)); return; }
        if (parts[3] === "runs" && parts[4] !== undefined && parts.length === 5) { const value = await repository.getRun(agentId, parts[4]); if (value === undefined) response.writeHead(404).end("Run Not Found"); else response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(json(value)); return; }
        if (parts[3] === "memories" && parts.length === 4) { const value = await repository.listMemories(agentId, limit(url)); response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(json(value)); return; }
        if (parts[3] === "predictions" && parts.length === 4) { const value = await repository.listPredictions(agentId, limit(url)); response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(json(value)); return; }
        if (parts[3] === "memory-updates" && parts.length === 4) { const value = await repository.listMemoryUpdates(agentId, limit(url)); response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(json(value)); return; }
        if (parts[3] === "background-experiences" && parts.length === 4) { const value = await repository.listBackgroundExperiences(agentId, limit(url)); response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(json(value)); return; }
        if (parts[3] === "g3" && parts.length === 4) { const value = await repository.listG3Tasks(agentId, limit(url)); response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" }).end(json(value)); return; }
        response.writeHead(404).end("Not Found");
      } catch (error) { if (response.headersSent || response.writableEnded) { response.destroy(); return; } response.writeHead(500, { "content-type": "application/json" }).end(json({ error: error instanceof Error ? error.message : "Internal Server Error" })); }
    })();
  });
}
