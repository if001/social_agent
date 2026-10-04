import { createHash } from "node:crypto";

import type { Pool, QueryResultRow } from "pg";

import type { EmbeddingProvider, IdGenerator } from "../../application/ports.js";
import { DomainError } from "../../domain/contracts.js";

export type WebPageDocument = { readonly url: string; readonly title: string; readonly markdown: string };
export type WebArchiveContext = { readonly agentId: string; readonly runId: string; readonly eventId: string; readonly toolCallId: string };
export type WebArchiveSearchInput = { readonly query: string; readonly limit: number; readonly fetchedAfter?: string | undefined; readonly urlPrefix?: string | undefined };
export type WebArchiveSearchResult = { readonly snapshotId: string; readonly url: string; readonly title: string; readonly summary: string; readonly fetchedAt: string; readonly excerpt: string };

type SnapshotRow = QueryResultRow & { id: string; canonical_url: string; fetched_url: string; title: string; raw_text: string; summary: string; fetched_at: Date; processing_status: "pending" | "ready" | "failed" };
type SearchRow = QueryResultRow & SnapshotRow & { excerpt: string };

export function canonicalizeWebUrl(value: string): string {
  const url = new URL(value); url.hash = "";
  if ((url.protocol === "https:" && url.port === "443") || (url.protocol === "http:" && url.port === "80")) url.port = "";
  url.hostname = url.hostname.toLowerCase();
  const entries = [...url.searchParams.entries()].sort(([aKey, aValue], [bKey, bValue]) => aKey.localeCompare(bKey) || aValue.localeCompare(bValue));
  url.search = ""; for (const [key, item] of entries) url.searchParams.append(key, item);
  return url.toString();
}

export function summarizeWebPage(title: string, markdown: string, maxLength = 2_000): string {
  const paragraphs = markdown.split(/\n{2,}/u).map((item) => item.replace(/^#+\s*/u, "").replace(/\s+/gu, " ").trim()).filter(Boolean);
  return [title.trim(), ...paragraphs].filter(Boolean).join("\n").slice(0, maxLength);
}

export function chunkWebPage(markdown: string, maxLength = 2_000, maxChunks = 64): readonly string[] {
  const normalized = markdown.replace(/\r\n/gu, "\n").trim(); if (normalized === "") return [];
  const chunks: string[] = []; let offset = 0;
  while (offset < normalized.length && chunks.length < maxChunks) {
    let end = Math.min(offset + maxLength, normalized.length);
    if (end < normalized.length) { const boundary = normalized.lastIndexOf("\n", end); if (boundary > offset + Math.floor(maxLength / 2)) end = boundary; }
    chunks.push(normalized.slice(offset, end).trim()); offset = end; while (normalized[offset] === "\n") offset += 1;
  }
  return chunks.filter(Boolean);
}

export class PostgresWebArchive {
  constructor(private readonly pool: Pool, private readonly embedding: EmbeddingProvider, private readonly ids: IdGenerator, private readonly now: () => Date, private readonly embeddingModel: string) {}

  async archivePages(documents: readonly WebPageDocument[], context: WebArchiveContext, signal: AbortSignal): Promise<readonly { snapshotId: string; url: string; status: string }[]> {
    const archived = [] as { snapshotId: string; url: string; status: string }[];
    for (const document of documents) {
      const canonicalUrl = canonicalizeWebUrl(document.url); const fetchedAt = this.now(); const hash = createHash("sha256").update(document.markdown).digest("hex");
      const resourceId = this.ids.next(); const snapshotId = this.ids.next(); const summary = summarizeWebPage(document.title, document.markdown); const chunks = chunkWebPage(document.markdown);
      const client = await this.pool.connect(); let saved: SnapshotRow | undefined;
      try {
        await client.query("BEGIN");
        await client.query("INSERT INTO web_resources(id,canonical_url,first_seen_at,last_seen_at) VALUES ($1,$2,$3,$3) ON CONFLICT (canonical_url) DO UPDATE SET last_seen_at=GREATEST(web_resources.last_seen_at,EXCLUDED.last_seen_at),updated_at=now()", [resourceId, canonicalUrl, fetchedAt]);
        const resource = await client.query<{ id: string }>("SELECT id FROM web_resources WHERE canonical_url=$1", [canonicalUrl]); const actualResourceId = resource.rows[0]?.id;
        if (actualResourceId === undefined) throw new DomainError("EXTERNAL", "Web resource could not be persisted");
        await client.query("INSERT INTO web_snapshots(id,resource_id,agent_id,fetched_url,title,raw_text,summary,content_hash,fetched_at,processing_status,source_run_id,source_tool_call_id,source_event_id) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'pending',$10,$11,$12) ON CONFLICT DO NOTHING", [snapshotId, actualResourceId, context.agentId, document.url, document.title, document.markdown, summary, hash, fetchedAt, context.runId, context.toolCallId, context.eventId]);
        const selected = await client.query<SnapshotRow>("SELECT s.id,r.canonical_url,s.fetched_url,s.title,s.raw_text,s.summary,s.fetched_at,s.processing_status FROM web_snapshots s JOIN web_resources r ON r.id=s.resource_id WHERE s.agent_id=$1 AND ((s.resource_id=$2 AND s.content_hash=$3) OR (s.source_run_id=$4 AND s.source_tool_call_id=$5 AND s.fetched_url=$6)) ORDER BY s.created_at LIMIT 1", [context.agentId, actualResourceId, hash, context.runId, context.toolCallId, document.url]);
        saved = selected.rows[0]; if (saved === undefined) throw new DomainError("EXTERNAL", "Web snapshot could not be persisted");
        for (const [index, text] of chunks.entries()) await client.query("INSERT INTO web_snapshot_chunks(snapshot_id,chunk_index,text) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING", [saved.id, index, text]);
        await client.query("COMMIT");
      } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
      if (saved.processing_status !== "ready") await this.#embedSnapshot(saved.id, summary, chunks, signal);
      const status = (await this.pool.query<{ processing_status: string }>("SELECT processing_status FROM web_snapshots WHERE id=$1", [saved.id])).rows[0]?.processing_status ?? saved.processing_status;
      archived.push({ snapshotId: saved.id, url: saved.fetched_url, status });
    }
    return archived;
  }

  async search(agentId: string, input: WebArchiveSearchInput, signal: AbortSignal): Promise<readonly WebArchiveSearchResult[]> {
    let vector: string | null = null;
    try { const [embedded] = await this.embedding.embed([input.query], signal); if (embedded !== undefined) vector = `[${embedded.join(",")}]`; } catch { /* keyword fallback */ }
    const keywords = input.query.normalize("NFKC").toLocaleLowerCase("ja").split(/\s+/u).filter((value) => value.length >= 2).slice(0, 32);
    const result = await this.pool.query<SearchRow>(`SELECT s.*,r.canonical_url,COALESCE((SELECT left(c.text,500) FROM web_snapshot_chunks c WHERE c.snapshot_id=s.id ORDER BY CASE WHEN $2::text IS NULL OR c.embedding IS NULL THEN 1 ELSE c.embedding <=> $2::vector END,c.chunk_index LIMIT 1),left(s.raw_text,500)) AS excerpt
      FROM web_snapshots s JOIN web_resources r ON r.id=s.resource_id WHERE s.agent_id=$1 AND ($4::timestamptz IS NULL OR s.fetched_at >= $4) AND ($5::text IS NULL OR r.canonical_url LIKE $5 || '%')
      ORDER BY COALESCE(CASE WHEN $2::text IS NULL OR s.embedding IS NULL THEN NULL ELSE s.embedding <=> $2::vector END,2), (SELECT count(*) FROM unnest($3::text[]) keyword WHERE position(keyword in lower(s.title || ' ' || s.summary || ' ' || s.raw_text))>0) DESC, s.fetched_at DESC,s.id LIMIT $6`, [agentId, vector, keywords, input.fetchedAfter ?? null, input.urlPrefix ?? null, input.limit]);
    return result.rows.map((row) => ({ snapshotId: row.id, url: row.canonical_url, title: row.title, summary: row.summary, fetchedAt: row.fetched_at.toISOString(), excerpt: row.excerpt }));
  }

  async get(agentId: string, snapshotId: string, chunkIndexes: readonly number[] = [], maxCharacters = 8_000): Promise<{ snapshotId: string; url: string; title: string; summary: string; fetchedAt: string; status: string; chunks: readonly { index: number; text: string }[] }> {
    const snapshot = (await this.pool.query<SnapshotRow>("SELECT s.*,r.canonical_url FROM web_snapshots s JOIN web_resources r ON r.id=s.resource_id WHERE s.id=$1 AND s.agent_id=$2", [snapshotId, agentId])).rows[0];
    if (snapshot === undefined) throw new DomainError("NOT_FOUND", "Web snapshot not found");
    const indexes = chunkIndexes.length === 0 ? [0] : [...new Set(chunkIndexes)].slice(0, 16);
    const rows = await this.pool.query<{ chunk_index: number; text: string }>("SELECT chunk_index,text FROM web_snapshot_chunks WHERE snapshot_id=$1 AND chunk_index=ANY($2::int[]) ORDER BY chunk_index", [snapshotId, indexes]);
    let remaining = maxCharacters; const chunks = rows.rows.flatMap(({ chunk_index, text }) => { if (remaining <= 0) return []; const bounded = text.slice(0, remaining); remaining -= bounded.length; return [{ index: chunk_index, text: bounded }]; });
    return { snapshotId, url: snapshot.canonical_url, title: snapshot.title, summary: snapshot.summary, fetchedAt: snapshot.fetched_at.toISOString(), status: snapshot.processing_status, chunks };
  }

  async backfill(agentId: string, limit: number, signal: AbortSignal): Promise<number> {
    const rows = await this.pool.query<SnapshotRow>("SELECT s.*,r.canonical_url FROM web_snapshots s JOIN web_resources r ON r.id=s.resource_id WHERE s.agent_id=$1 AND s.processing_status IN ('pending','failed') ORDER BY s.fetched_at,s.id LIMIT $2", [agentId, limit]);
    for (const row of rows.rows) { const chunks = (await this.pool.query<{ text: string }>("SELECT text FROM web_snapshot_chunks WHERE snapshot_id=$1 ORDER BY chunk_index", [row.id])).rows.map(({ text }) => text); await this.#embedSnapshot(row.id, row.summary, chunks, signal); }
    return rows.rows.length;
  }

  async #embedSnapshot(snapshotId: string, summary: string, chunks: readonly string[], signal: AbortSignal): Promise<void> {
    await this.pool.query("UPDATE web_snapshots SET processing_status='pending',embedding_error=NULL,embedding_last_attempt_at=now(),updated_at=now() WHERE id=$1", [snapshotId]);
    try {
      const vectors = await this.embedding.embed([summary, ...chunks], signal); const summaryVector = vectors[0];
      if (summaryVector === undefined || vectors.some((vector) => vector.length !== this.embedding.dimension)) throw new DomainError("VALIDATION", "Web archive embedding dimension mismatch");
      const client = await this.pool.connect(); try { await client.query("BEGIN"); await client.query("UPDATE web_snapshots SET embedding=$2::vector,embedding_model=$3,embedding_dimension=$4,processing_status='ready',embedding_error=NULL,updated_at=now() WHERE id=$1", [snapshotId, `[${summaryVector.join(",")}]`, this.embeddingModel, this.embedding.dimension]); for (let index = 0; index < chunks.length; index += 1) await client.query("UPDATE web_snapshot_chunks SET embedding=$3::vector,embedding_model=$4,embedding_dimension=$5 WHERE snapshot_id=$1 AND chunk_index=$2", [snapshotId, index, `[${(vectors[index + 1] ?? []).join(",")}]`, this.embeddingModel, this.embedding.dimension]); await client.query("COMMIT"); } catch (error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
    } catch (error) { await this.pool.query("UPDATE web_snapshots SET processing_status='failed',embedding_error=$2,updated_at=now() WHERE id=$1", [snapshotId, error instanceof Error ? error.message.slice(0, 2_000) : "Embedding failed"]); }
  }
}
