import { boundedEntries, matchingRanges, textLines, textRange } from "../tools/text-extraction.js";
import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { resolve, sep } from "node:path";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import type { EmbeddingProvider, IdGenerator } from "../../application/ports.js";
import { DomainError } from "../../domain/contracts.js";
import type { WebArchive, WebPageSummarizer, WebPageDocument, WebArchiveContext, WebArchiveSearchInput, WebArchiveSearchResult, ArchivedWebPage } from "../../application/web-archive.js";
import type { RuntimeDatabase } from "./runtime-database.js";
import { webResources, webSnapshots } from "./schema.js";

type SnapshotRow = { id: string; canonical_url: string; fetched_url: string; title: string; raw_file_path: string; summary: string; fetched_at: Date; processing_status: "pending" | "ready" | "failed" };

export function canonicalizeWebUrl(value: string): string {
  const url = new URL(value); url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.hostname = url.hostname.toLowerCase(); const entries = [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
  url.search = ""; for (const [key, item] of entries) url.searchParams.append(key, item); return url.toString();
}

export class PostgresWebArchive implements WebArchive {
  readonly #root: string;
  constructor(private readonly database: RuntimeDatabase, private readonly embedding: EmbeddingProvider, private readonly summarizer: WebPageSummarizer, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly embeddingModel: string, root: string) { this.#root = resolve(root); }

  async archivePages(documents: readonly WebPageDocument[], context: WebArchiveContext, signal: AbortSignal): Promise<readonly ArchivedWebPage[]> {
    await mkdir(this.#root, { recursive: true }); const archived: ArchivedWebPage[] = [];
    for (const document of documents) archived.push(await this.#archive(document, context, signal)); return archived;
  }

  async #archive(document: WebPageDocument, context: WebArchiveContext, signal: AbortSignal): Promise<ArchivedWebPage> {
    const canonicalUrl = canonicalizeWebUrl(document.url); const fetchedAt = this.now(); const hash = createHash("sha256").update(document.markdown).digest("hex"); const resourceId = this.ids.next();
    await this.database.db.insert(webResources).values({ id: resourceId, canonicalUrl, firstSeenAt: fetchedAt, lastSeenAt: fetchedAt })
      .onConflictDoUpdate({ target: webResources.canonicalUrl, set: { lastSeenAt: sql`greatest(${webResources.lastSeenAt},excluded.last_seen_at)`, updatedAt: new Date() } });
    const actualResourceId = (await this.database.db.select({ id: webResources.id }).from(webResources).where(eq(webResources.canonicalUrl, canonicalUrl)).limit(1))[0]?.id;
    if (actualResourceId === undefined) throw new DomainError("EXTERNAL", "Web resource could not be persisted");
    const existing = (await this.#snapshots(and(eq(webSnapshots.resourceId, actualResourceId), eq(webSnapshots.contentHash, hash)), 1))[0];
    if (existing !== undefined) { if (existing.processing_status !== "ready") await this.#process(existing.id, signal); return await this.#result(existing.id); }
    const snapshotId = this.ids.next(); const relativePath = `${snapshotId}.md`; const finalPath = this.#path(relativePath); const temporaryPath = `${finalPath}.tmp-${context.runId.replaceAll(/[^a-zA-Z0-9_-]/gu, "_")}`;
    await writeFile(temporaryPath, document.markdown, { encoding: "utf8", flag: "wx" }); await rename(temporaryPath, finalPath);
    try {
      await this.database.db.insert(webSnapshots).values({ id: snapshotId, resourceId: actualResourceId, fetchedByAgentId: context.agentId, fetchedUrl: document.url, title: document.title, rawFilePath: relativePath, summary: "", contentHash: hash, fetchedAt, processingStatus: "pending", sourceRunId: context.runId, sourceToolCallId: context.toolCallId }).onConflictDoNothing();
      const saved = (await this.#snapshots(and(eq(webSnapshots.resourceId, actualResourceId), eq(webSnapshots.contentHash, hash)), 1))[0];
      if (saved === undefined) throw new DomainError("EXTERNAL", "Web snapshot could not be persisted"); if (saved.id !== snapshotId) await rm(finalPath, { force: true });
      if (saved.processing_status !== "ready") await this.#process(saved.id, signal); return await this.#result(saved.id);
    } catch (error) { await rm(finalPath, { force: true }); throw error; }
  }

  async #result(snapshotId: string): Promise<ArchivedWebPage> {
    const row = await this.#snapshot(snapshotId); return { snapshotId: row.id, url: row.canonical_url, title: row.title, summary: row.summary, fetchedAt: row.fetched_at.toISOString(), status: row.processing_status, reference: { type: "web-snapshot", id: row.id } };
  }

  async search(input: WebArchiveSearchInput, signal: AbortSignal): Promise<readonly WebArchiveSearchResult[]> {
    let vector: string | null = null; try { const [embedded] = await this.embedding.embed([input.query], signal); if (embedded !== undefined) vector = `[${embedded.join(",")}]`; } catch { /* keyword fallback */ }
    const keywords = input.query.normalize("NFKC").toLocaleLowerCase("ja").split(/\s+/u).filter((value) => value.length >= 2).slice(0, 32);
    // PostgreSQL-native: pgvector distance and keyword ranking form the archive RAG query.
    const result = await this.database.db.execute(sql<SnapshotRow>`SELECT s.*,r.canonical_url FROM app.web_snapshots s JOIN app.web_resources r ON r.id=s.resource_id WHERE s.processing_status='ready' AND (${input.fetchedAfter ?? null}::timestamptz IS NULL OR s.fetched_at >= ${input.fetchedAfter ?? null}) AND (${input.urlPrefix ?? null}::text IS NULL OR r.canonical_url LIKE ${input.urlPrefix ?? null} || '%') ORDER BY COALESCE(CASE WHEN ${vector}::text IS NULL OR s.embedding IS NULL THEN NULL ELSE s.embedding <=> ${vector}::vector END,2),(SELECT count(*) FROM jsonb_array_elements_text(${JSON.stringify(keywords)}::jsonb) keyword WHERE position(keyword in lower(s.title || ' ' || s.summary || ' ' || r.canonical_url))>0) DESC,s.fetched_at DESC,s.id LIMIT ${input.limit}`);
    return (result.rows as unknown as SnapshotRow[]).map((row) => ({ snapshotId: row.id, url: row.canonical_url, title: row.title, summary: row.summary, fetchedAt: new Date(row.fetched_at).toISOString(), reference: { type: "web-snapshot", id: row.id } }));
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

  async backfill(limit: number, signal: AbortSignal): Promise<number> {
    const rows = await this.database.db.select({ id: webSnapshots.id }).from(webSnapshots)
      .where(inArray(webSnapshots.processingStatus, ["pending", "failed"]))
      .orderBy(asc(webSnapshots.fetchedAt), asc(webSnapshots.id)).limit(limit);
    for (const row of rows) await this.#process(row.id, signal); return rows.length;
  }

  async #process(snapshotId: string, signal: AbortSignal): Promise<void> {
    const row = await this.#snapshot(snapshotId);
    await this.database.db.update(webSnapshots).set({ processingStatus: "pending", embeddingError: null, embeddingLastAttemptAt: new Date(), updatedAt: new Date() }).where(eq(webSnapshots.id, snapshotId));
    try { const markdown = await readFile(this.#path(row.raw_file_path), "utf8"); const summary = await this.summarizer.summarize({ url: row.canonical_url, title: row.title, markdown }, signal); if (summary.length === 0 || summary.length > 400) throw new DomainError("VALIDATION", "Web page summary must contain 1 to 400 characters"); const [vector] = await this.embedding.embed([summary], signal); if (vector === undefined || vector.length !== this.embedding.dimension) throw new DomainError("VALIDATION", "Web archive embedding dimension mismatch"); await this.database.db.update(webSnapshots).set({ summary, embedding: [...vector], embeddingModel: this.embeddingModel, embeddingDimension: this.embedding.dimension, processingStatus: "ready", embeddingError: null, updatedAt: new Date() }).where(eq(webSnapshots.id, snapshotId)); }
    catch (error) { await this.database.db.update(webSnapshots).set({ processingStatus: "failed", embeddingError: errorDetails(error), updatedAt: new Date() }).where(eq(webSnapshots.id, snapshotId)); }
  }

  async #snapshots(condition: ReturnType<typeof eq> | ReturnType<typeof and>, limit: number): Promise<SnapshotRow[]> {
    return this.database.db.select({ id: webSnapshots.id, canonical_url: webResources.canonicalUrl, fetched_url: webSnapshots.fetchedUrl, title: webSnapshots.title, raw_file_path: webSnapshots.rawFilePath, summary: webSnapshots.summary, fetched_at: webSnapshots.fetchedAt, processing_status: webSnapshots.processingStatus }).from(webSnapshots).innerJoin(webResources, eq(webResources.id, webSnapshots.resourceId)).where(condition).orderBy(asc(webSnapshots.createdAt)).limit(limit) as Promise<SnapshotRow[]>;
  }
  async #snapshot(snapshotId: string): Promise<SnapshotRow> { const row = (await this.#snapshots(eq(webSnapshots.id, snapshotId), 1))[0]; if (row === undefined) throw new DomainError("NOT_FOUND", "Web snapshot not found"); return row; }
  #path(relativePath: string): string { const path = resolve(this.#root, relativePath); if (path !== this.#root && !path.startsWith(`${this.#root}${sep}`)) throw new DomainError("VALIDATION", "Web snapshot path escapes archive root"); return path; }
}

function errorDetails(error: unknown): string {
  const messages: string[] = []; let current: unknown = error;
  for (let depth = 0; depth < 4 && current instanceof Error; depth += 1) { messages.push(current.message); current = current.cause; }
  return (messages.filter((value, index) => value.length > 0 && messages.indexOf(value) === index).join(": ") || "Web archive processing failed").slice(0, 2_000);
}
