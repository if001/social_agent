import { z } from "zod";

import type { RegisteredTool } from "../../application/tool-registry.js";
import { DomainError } from "../../domain/contracts.js";

const HttpUrl = z.url().refine((value) => ["http:", "https:"].includes(new URL(value).protocol));
const SearchResult = z.object({ rank: z.number().int().positive(), title: z.string(), url: HttpUrl, snippet: z.string().nullable().optional(), published_date: z.string().nullable().optional() });
const ListResponse = z.object({ query: z.string(), k: z.number().int(), results: z.array(SearchResult) });
const PageResponse = z.object({ docs: z.array(z.object({ url: HttpUrl, title: z.string(), markdown: z.string() })) });
type WebOptions = { readonly timeoutMs?: number; readonly maxBytes?: number; readonly fetcher?: typeof fetch };

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
  return [
    { name: "web_list", description: "Search the web", schema: z.object({ q: z.string().min(1), k: z.number().int().min(1).max(20) }), execute: async (input, _context, signal) => ({ ok: true, value: await request(baseUrl, "/list", input, ListResponse, signal, options) }) },
    { name: "web_page", description: "Read a web page", schema: z.object({ url: HttpUrl }), execute: async (input, _context, signal) => ({ ok: true, value: await request(baseUrl, "/page", input, PageResponse, signal, options) }) }
  ];
}
