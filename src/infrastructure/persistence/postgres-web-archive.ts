import { boundedEntries, matchingRanges, textLines, textRange } from "../tools/text-extraction.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { Pool, QueryResultRow } from "pg";
import type { EmbeddingProvider, IdGenerator } from "../../application/ports.js";
import { DomainError } from "../../domain/contracts.js";
import type { WebPageSummarizer } from "../agent/web-summary-harness.js";

export type WebPageDocument = { readonly url: string; readonly title: string; readonly markdown: string };
export type WebArchiveContext = { readonly agentId: string; readonly runId: string; readonly eventId: string; readonly toolCallId: string };
export type WebArchiveSearchInput = { readonly query: string; readonly limit: number; readonly fetchedAfter?: string | undefined; readonly urlPrefix?: string | undefined };
export type WebArchiveSearchResult = { readonly snapshotId: string; readonly url: string; readonly title: string; readonly summary: string; readonly fetchedAt: string; readonly reference: { readonly type: "web-snapshot"; readonly id: string } };
export type ArchivedWebPage = WebArchiveSearchResult & { readonly status: string };
type SnapshotRow = QueryResultRow & { id: string; canonical_url: string; fetched_url: string; title: string; raw_file_path: string; summary: string; fetched_at: Date; processing_status: "pending" | "ready" | "failed" };

export function canonicalizeWebUrl(value: string): string {
  const url = new URL(value); url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.hostname = url.hostname.toLowerCase(); const entries = [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
  url.search = ""; for (const [key, item] of entries) url.searchParams.append(key, item); return url.toString();
}

export class PostgresWebArchive {
  readonly #root: string;
  constructor(private readonly pool: Pool, private readonly embedding: EmbeddingProvider, private readonly summarizer: WebPageSummarizer, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly embeddingModel: string, root: string) { this.#root = resolve(root); }

  async archivePages(documents: readonly WebPageDocument[], context: WebArchiveContext, signal: AbortSignal): Promise<readonly ArchivedWebPage[]> {
    await mkdir(this.#root, { recursive: true }); const archived: ArchivedWebPage[] = [];
    for (const document of documents) archived.push(await this.#archive(document, context, signal)); return archived;
  }

  async #archive(document: WebPageDocument, context: WebArchiveContext, signal: AbortSignal): Promise<ArchivedWebPage> {
    const canonicalUrl = canonicalizeWebUrl(document.url); const fetchedAt = this.now(); const hash = createHash("sha256").update(document.markdown).digest("hex"); const resourceId = this.ids.next();
    await this.pool.query("INSERT INTO web_resources(id,canonical_url,first_seen_at,last_seen_at) VALUES ($1,$2,$3,$3) ON CONFLICT (canonical_url) DO UPDATE SET last_seen_at=GREATEST(web_resources.last_seen_at,EXCLUDED.last_seen_at),updated_at=now()", [resourceId, canonicalUrl, fetchedAt]);
    const actualResourceId = (await this.pool.query<{ id: string }>("SELECT id FROM web_resources WHERE canonical_url=$1", [canonicalUrl])).rows[0]?.id;
    if (actualResourceId === undefined) throw new DomainError("EXTERNAL", "Web resource could not be persisted");
    const existing = (await this.pool.query<SnapshotRow>("SELECT s.*,r.canonical_url FROM web_snapshots s JOIN web_resources r ON r.id=s.resource_id WHERE s.resource_id=$1 AND s.content_hash=$2 ORDER BY s.created_at LIMIT 1", [actualResourceId, hash])).rows[0];
    if (existing !== undefined) { if (existing.processing_status !== "ready") await this.#process(existing.id, signal); return await this.#result(existing.id); }
    const snapshotId = this.ids.next(); const relativePath = `${snapshotId}.md`; const finalPath = this.#path(relativePath); const temporaryPath = `${finalPath}.tmp-${context.runId.replaceAll(/[^a-zA-Z0-9_-]/gu, "_")}`;
    await writeFile(temporaryPath, document.markdown, { encoding: "utf8", flag: "wx" }); await rename(temporaryPath, finalPath);
    try {
      await this.pool.query("INSERT INTO web_snapshots(id,resource_id,agent_id,fetched_url,title,raw_file_path,summary,content_hash,fetched_at,processing_status,source_run_id,source_tool_call_id,source_event_id) VALUES ($1,$2,$3,$4,$5,$6,'',$7,$8,'pending',$9,$10,$11) ON CONFLICT DO NOTHING", [snapshotId, actualResourceId, context.agentId, document.url, document.title, relativePath, hash, fetchedAt, context.runId, context.toolCallId, context.eventId]);
      const saved = (await this.pool.query<SnapshotRow>("SELECT s.*,r.canonical_url FROM web_snapshots s JOIN web_resources r ON r.id=s.resource_id WHERE s.resource_id=$1 AND s.content_hash=$2 ORDER BY s.created_at LIMIT 1", [actualResourceId, hash])).rows[0];
      if (saved === undefined) throw new DomainError("EXTERNAL", "Web snapshot could not be persisted"); if (saved.id !== snapshotId) await rm(finalPath, { force: true });
      if (saved.processing_status !== "ready") await this.#process(saved.id, signal); return await this.#result(saved.id);
    } catch (error) { await rm(finalPath, { force: true }); throw error; }
  }

  async #result(snapshotId: string): Promise<ArchivedWebPage> {
    const row = await this.#snapshot(snapshotId); return { snapshotId: row.id, url: row.canonical_url, title: row.title, summary: row.summary, fetchedAt: row.fetched_at.toISOString(), status: row.processing_status, reference: { type: "web-snapshot", id: row.id } };
  }

  async search(_agentId: string, input: WebArchiveSearchInput, signal: AbortSignal): Promise<readonly WebArchiveSearchResult[]> {
    let vector: string | null = null; try { const [embedded] = await this.embedding.embed([input.query], signal); if (embedded !== undefined) vector = `[${embedded.join(",")}]`; } catch { /* keyword fallback */ }
    const keywords = input.query.normalize("NFKC").toLocaleLowerCase("ja").split(/\s+/u).filter((value) => value.length >= 2).slice(0, 32);
    const result = await this.pool.query<SnapshotRow>(`SELECT s.*,r.canonical_url FROM web_snapshots s JOIN web_resources r ON r.id=s.resource_id WHERE s.processing_status='ready' AND ($3::timestamptz IS NULL OR s.fetched_at >= $3) AND ($4::text IS NULL OR r.canonical_url LIKE $4 || '%') ORDER BY COALESCE(CASE WHEN $1::text IS NULL OR s.embedding IS NULL THEN NULL ELSE s.embedding <=> $1::vector END,2),(SELECT count(*) FROM unnest($2::text[]) keyword WHERE position(keyword in lower(s.title || ' ' || s.summary || ' ' || r.canonical_url))>0) DESC,s.fetched_at DESC,s.id LIMIT $5`, [vector, keywords, input.fetchedAfter ?? null, input.urlPrefix ?? null, input.limit]);
    return result.rows.map((row) => ({ snapshotId: row.id, url: row.canonical_url, title: row.title, summary: row.summary, fetchedAt: row.fetched_at.toISOString(), reference: { type: "web-snapshot", id: row.id } }));
  }

  async read(snapshotId: string, offset = 0, maxCharacters = 2_000): Promise<{ snapshotId: string; offset: number; text: string; truncated: boolean }> {
    const row = await this.#snapshot(snapshotId); const text = await readFile(this.#path(row.raw_file_path), "utf8"); return { snapshotId, offset, ...textRange(text, offset, maxCharacters) };
  }

  async grep(snapshotId: string, pattern: string, contextLines = 2, maxMatches = 10, maxCharacters = 2_000): Promise<{ snapshotId: string; matches: readonly { line: number; text: string }[]; truncated: boolean }> {
    const row = await this.#snapshot(snapshotId);
    const lines = textLines(await readFile(this.#path(row.raw_file_path), "utf8"));
    const ranges = boundedEntries(matchingRanges(lines, pattern, contextLines), maxMatches, Infinity, () => 0);
    const selected = new Map<number, string>();
    for (const range of ranges.entries) range.lines.forEach((text, index) => selected.set(range.start + index + 1, text));
    const bounded = boundedEntries([...selected].map(([line, text]) => ({ line, text })), Infinity, maxCharacters, ({ text }) => text.length);
    return { snapshotId, matches: bounded.entries, truncated: ranges.truncated || bounded.truncated };
  }

  async backfill(_agentId: string, limit: number, signal: AbortSignal): Promise<number> {
    const rows = await this.pool.query<{ id: string }>("SELECT id FROM web_snapshots WHERE processing_status IN ('pending','failed') ORDER BY fetched_at,id LIMIT $1", [limit]); for (const row of rows.rows) await this.#process(row.id, signal); return rows.rows.length;
  }

  async #process(snapshotId: string, signal: AbortSignal): Promise<void> {
    const row = await this.#snapshot(snapshotId); await this.pool.query("UPDATE web_snapshots SET processing_status='pending',embedding_error=NULL,embedding_last_attempt_at=now(),updated_at=now() WHERE id=$1", [snapshotId]);
    try { const markdown = await readFile(this.#path(row.raw_file_path), "utf8"); const summary = await this.summarizer.summarize({ url: row.canonical_url, title: row.title, markdown }, signal); if (summary.length === 0 || summary.length > 400) throw new DomainError("VALIDATION", "Web page summary must contain 1 to 400 characters"); const [vector] = await this.embedding.embed([summary], signal); if (vector === undefined || vector.length !== this.embedding.dimension) throw new DomainError("VALIDATION", "Web archive embedding dimension mismatch"); await this.pool.query("UPDATE web_snapshots SET summary=$2,embedding=$3::vector,embedding_model=$4,embedding_dimension=$5,processing_status='ready',embedding_error=NULL,updated_at=now() WHERE id=$1", [snapshotId, summary, `[${vector.join(",")}]`, this.embeddingModel, this.embedding.dimension]); }
    catch (error) { await this.pool.query("UPDATE web_snapshots SET processing_status='failed',embedding_error=$2,updated_at=now() WHERE id=$1", [snapshotId, errorDetails(error)]); }
  }

  async #snapshot(snapshotId: string): Promise<SnapshotRow> { const row = (await this.pool.query<SnapshotRow>("SELECT s.*,r.canonical_url FROM web_snapshots s JOIN web_resources r ON r.id=s.resource_id WHERE s.id=$1", [snapshotId])).rows[0]; if (row === undefined) throw new DomainError("NOT_FOUND", "Web snapshot not found"); return row; }
  #path(relativePath: string): string { const path = resolve(this.#root, relativePath); if (path !== this.#root && !path.startsWith(`${this.#root}${sep}`)) throw new DomainError("VALIDATION", "Web snapshot path escapes archive root"); return path; }
}

function errorDetails(error: unknown): string {
  const messages: string[] = []; let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) { messages.push(current.message); current = current.cause; }
  return (messages.filter((value, index) => value.length > 0 && messages.indexOf(value) === index).join(": ") || "Web archive processing failed").slice(0, 2_000);
}
