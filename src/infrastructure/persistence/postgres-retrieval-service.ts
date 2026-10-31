import type { Pool, QueryResultRow } from "pg";

import type { EmbeddingProvider, RetrievalInput, RetrievalService } from "../../application/ports.js";
import { memoryKeywords } from "../../application/memory-query.js";
import type { RetrievedItem, RetrievalSignal } from "../../domain/contracts.js";

type Row = QueryResultRow & {
  source: "conversation" | "background";
  id: string;
  kind: string;
  content: string;
  importance: string;
  occurred_at: Date;
  vector_rank: string | null;
  keyword_rank: string | null;
  subject_rank: string | null;
  recency_rank: string;
};

const CONVERSATION_KINDS = ["episodic", "semantic", "self-related", "self-change", "common-ground"] as const;
const rank = (value: string | null): number | undefined => value === null ? undefined : Number(value);

export class PostgresRetrievalService implements RetrievalService {
  constructor(
    private readonly pool: Pool,
    private readonly embeddingProvider?: EmbeddingProvider
  ) {}

  async retrieve(input: RetrievalInput): Promise<readonly RetrievedItem[]> {
    const limit = Math.min(Math.max(input.limit, 1), 100);
    const scope = input.scope ?? "all";
    const includeConversation = scope !== "background";
    const includeBackground = scope !== "conversation" && (input.kinds === undefined || input.kinds.includes("background"));
    const queryText = input.query.trim();
    const keywords = (input.keywords ?? memoryKeywords([queryText])).map((value) => value.toLocaleLowerCase("ja"));
    const conversationKinds = (input.kinds ?? CONVERSATION_KINDS).filter((kind) => kind !== "background");
    if (conversationKinds.length === 0 && !includeBackground) return [];
    let embedding: readonly number[] = input.embedding ?? [];
    if (embedding.length === 0 && this.embeddingProvider !== undefined && queryText.length > 0) {
      try {
        embedding = (await this.embeddingProvider.embed([queryText], new AbortController().signal))[0] ?? [];
      } catch {
        embedding = [];
      }
    }
    const vectorValue = embedding.length > 0 ? `[${embedding.join(",")}]` : null;
    const subjectIds = input.subjectIds ?? [];
    const subjectFilter = input.subjectFilter ?? false;
    const occurredAfter = input.occurredAfter ?? null;
    const result = await this.pool.query<Row>(`WITH base AS (
      SELECT 'conversation'::text AS source,m.id,m.kind,m.content,m.importance,m.retrieval_priority,m.occurred_at,m.embedding,m.embedding_status,
        (SELECT count(*)::int FROM memory_subjects ms WHERE ms.memory_id=m.id AND ms.subject_id=ANY($4::text[])) AS subject_hits
      FROM memories m
      WHERE m.agent_id=$1 AND $6::boolean AND m.kind=ANY($5::text[]) AND ($10::timestamptz IS NULL OR m.occurred_at >= $10)
      UNION ALL
      SELECT 'background'::text,b.id,'background'::text,concat_ws(' ',b.place,b.action,b.feeling,b.outcome,b.lesson),b.importance,'normal'::text,b.occurred_at,b.embedding,b.embedding_status,0
      FROM background_experiences b
      WHERE b.agent_id=$1 AND $7::boolean AND ($10::timestamptz IS NULL OR b.occurred_at >= $10)
    ), scored AS (
      SELECT base.*,
        CASE WHEN $2::text IS NULL OR embedding IS NULL OR embedding_status<>'ready' THEN NULL ELSE 1-(embedding <=> $2::vector) END AS vector_similarity,
        (SELECT count(*)::int FROM unnest($3::text[]) keyword WHERE length(keyword)>=2 AND position(keyword in lower(content))>0) AS keyword_hits
      FROM base
    ), ranked AS (
      SELECT scored.*,
        CASE WHEN vector_similarity IS NULL THEN NULL ELSE row_number() OVER (ORDER BY vector_similarity DESC NULLS LAST,occurred_at DESC,id) END AS vector_rank,
        CASE WHEN keyword_hits=0 THEN NULL ELSE row_number() OVER (ORDER BY keyword_hits DESC,occurred_at DESC,id) END AS keyword_rank,
        CASE WHEN subject_hits=0 THEN NULL ELSE row_number() OVER (ORDER BY subject_hits DESC,occurred_at DESC,id) END AS subject_rank,
        row_number() OVER (ORDER BY occurred_at DESC,id) AS recency_rank
      FROM scored
    ) SELECT ranked.* FROM ranked WHERE (NOT $9::boolean OR subject_hits>0) ORDER BY
      COALESCE(1.0/(60+vector_rank),0)+COALESCE(1.0/(60+keyword_rank),0)+COALESCE(1.0/(60+subject_rank),0)+0.25/(60+recency_rank)+
      CASE retrieval_priority WHEN 'critical' THEN 0.012 WHEN 'high' THEN 0.006 WHEN 'low' THEN -0.002 ELSE 0 END DESC,
      occurred_at DESC,id ASC LIMIT $8`, [input.agentId, vectorValue, keywords, subjectIds, conversationKinds, includeConversation, includeBackground, limit, subjectFilter, occurredAfter]);
    return result.rows.map((row, index) => {
      const matchedBy: RetrievalSignal[] = [];
      if (rank(row.vector_rank) !== undefined) matchedBy.push("vector");
      if (rank(row.keyword_rank) !== undefined) matchedBy.push("keyword");
      if (rank(row.subject_rank) !== undefined) matchedBy.push("subject");
      matchedBy.push("recency");
      return { source: row.source, id: row.id, kind: row.kind, content: row.content, occurredAt: row.occurred_at.toISOString(), importance: row.importance, matchedBy, finalRank: index + 1 };
    });
  }
}
