import { z } from "zod";

import type { RegisteredTool } from "../../application/tool-registry.js";
import { DomainError } from "../../domain/contracts.js";
import type { PostgresWebArchive } from "../persistence/postgres-web-archive.js";

const HttpUrl = z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol));
const SearchResult = z.object({ rank: z.number().int().positive(), title: z.string(), url: HttpUrl, snippet: z.string().nullable().optional(), published_date: z.string().nullable().optional() });
const ListResponse = z.object({ query: z.string(), k: z.number().int(), results: z.array(SearchResult) });
const PageResponse = z.object({ docs: z.array(z.object({ url: HttpUrl, title: z.string(), markdown: z.string() })) });
type WebOptions = { readonly timeoutMs?: number; readonly maxBytes?: number; readonly fetcher?: typeof fetch; readonly archive?: PostgresWebArchive };

async function request<T>(baseUrl: string, path: "/list" | "/page", body: unknown, schema: z.ZodType<T>, signal: AbortSignal, options: WebOptions): Promise<T> {
  const combined = AbortSignal.any([signal, AbortSignal.timeout(options.timeoutMs ?? 10_000)]);
  let response: Response;
  try { response = await (options.fetcher ?? fetch)(new URL(path, baseUrl), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: combined }); }
  catch (error) { throw new DomainError(combined.aborted ? "TIMEOUT" : "EXTERNAL", "Web tool request failed", { cause: error }); }
  if (!response.ok) throw new DomainError("EXTERNAL", `Web tool returned HTTP ${String(response.status)}`);
  const text = await response.text();
  if (Buffer.byteLength(text) > (options.maxBytes ?? 1_000_000)) throw new DomainError("VALIDATION", "Web tool response is too large");
  let json: unknown; try { json = JSON.parse(text); } catch (error) { throw new DomainError("VALIDATION", "Web tool returned invalid JSON", { cause: error }); }
  const parsed = schema.safeParse(json); if (!parsed.success) throw new DomainError("VALIDATION", "Web tool response does not match its contract", { cause: parsed.error });
  return parsed.data;
}

export function createWebTools(baseUrl: string, options: WebOptions = {}): readonly RegisteredTool[] {
  const serviceUrl = new URL(baseUrl); if (!["http:", "https:"].includes(serviceUrl.protocol)) throw new Error("Web service base URL must use HTTP(S)");
  const tools: RegisteredTool[] = [
    { name: "web_list", description: "Search the web", schema: z.object({ q: z.string().min(1), k: z.number().int().min(1).max(20) }), execute: async (input, _context, signal) => ({ ok: true, value: await request(baseUrl, "/list", input, ListResponse, signal, options) }) },
    { name: "web_page", description: "Read and archive a web page", schema: z.object({ url: HttpUrl }), execute: async (input, context, signal) => { const page = await request(baseUrl, "/page", input, PageResponse, signal, options); const archivedSnapshots = options.archive === undefined ? [] : await options.archive.archivePages(page.docs, { agentId: context.agentId, runId: context.runId, eventId: context.eventId ?? context.runId, toolCallId: context.toolCallId ?? context.idempotencyKey }, signal); return { ok: true, value: { ...page, archivedSnapshots } }; } }
  ];
  if (options.archive !== undefined) tools.push(
    { name: "web_archive_search", description: "Search previously archived web pages owned by this agent", schema: z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(20).default(5), fetchedAfter: z.iso.datetime({ offset: true }).optional(), urlPrefix: HttpUrl.optional() }), execute: async (raw, context, signal) => { const input = z.object({ query: z.string().min(1), limit: z.number().int().min(1).max(20).default(5), fetchedAfter: z.iso.datetime({ offset: true }).optional(), urlPrefix: HttpUrl.optional() }).parse(raw); return { ok: true, value: { results: await options.archive?.search(context.agentId, input, signal) ?? [] } }; } },
    { name: "web_archive_get", description: "Read bounded chunks from an archived web page owned by this agent", schema: z.object({ snapshotId: z.string().min(1), chunkIndexes: z.array(z.number().int().nonnegative()).max(16).default([]), maxCharacters: z.number().int().min(1).max(16_000).default(8_000) }), execute: async (raw, context) => { const input = z.object({ snapshotId: z.string().min(1), chunkIndexes: z.array(z.number().int().nonnegative()).max(16).default([]), maxCharacters: z.number().int().min(1).max(16_000).default(8_000) }).parse(raw); return { ok: true, value: await options.archive?.get(context.agentId, input.snapshotId, input.chunkIndexes, input.maxCharacters) }; } }
  );
  return tools;
}
