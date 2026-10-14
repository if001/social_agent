import type { Pool, QueryResultRow } from "pg";
import { z } from "zod";

import type { RegisteredTool } from "../../application/tool-registry.js";
import { ConcernProposalSchema, ConcernSchema, RelationshipSchema, SelfSchema } from "../../domain/contracts.js";

type StateRow = QueryResultRow & { concerns: unknown; relationships: unknown; mood: string };
type SelfRow = QueryResultRow & { identity: string; disposition: string; self_story: string; commitments: unknown; mood: string };
type MemoryRow = QueryResultRow & { id: string; content: string; importance: string; occurred_at: Date };

const compact = (value: string, limit: number): string => value.length <= limit ? value : `${value.slice(0, limit)}…`;
const success = (value: unknown) => Promise.resolve({ ok: true as const, value });

export function createAgentContextTools(pool: Pool): readonly RegisteredTool[] {
  return [
    {
      name: "concern_list",
      description: "自分のactive ConcernをFocus選択用の短い一覧で取得する。自律Eventではまずこれで1件を選ぶ。",
      schema: z.object({ limit: z.number().int().min(1).max(12).default(8).describe("返す最大件数") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ limit }: { limit: number }, context) => {
        const row = (await pool.query<StateRow>("SELECT concerns,relationships,mood FROM agent_states WHERE agent_id=$1", [context.agentId])).rows[0];
        const now = Date.now();
        const concerns = z.array(ConcernSchema).parse(row?.concerns ?? []).filter(({ status }) => status === "active").sort((a, b) => {
          const aDue = a.reconsiderAt !== undefined && Date.parse(a.reconsiderAt) <= now ? 0 : 1;
          const bDue = b.reconsiderAt !== undefined && Date.parse(b.reconsiderAt) <= now ? 0 : 1;
          return aDue - bDue || (a.reconsiderAt ?? "9999").localeCompare(b.reconsiderAt ?? "9999");
        }).slice(0, limit).map(({ id, description, reconsiderAt }) => ({ id, description: compact(description, 240), ...(reconsiderAt === undefined ? {} : { reconsiderAt }) }));
        return success({ count: concerns.length, concerns });
      }
    },
    {
      name: "concern_get",
      description: "選んだFocus Concern 1件の内容を取得する。1 EventではFocusを1件だけにする。",
      schema: z.object({ concernId: z.string().min(1).describe("concern_listで得たConcern ID") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ concernId }: { concernId: string }, context) => {
        const row = (await pool.query<StateRow>("SELECT concerns,relationships,mood FROM agent_states WHERE agent_id=$1", [context.agentId])).rows[0];
        const concern = z.array(ConcernSchema).parse(row?.concerns ?? []).find(({ id }) => id === concernId);
        return concern === undefined ? { ok: false, error: "Concern not found" } : { ok: true, value: { ...concern, description: compact(concern.description, 400), whyItMatters: compact(concern.whyItMatters, 400) } };
      }
    },
    {
      name: "concern_propose",
      description: "次回以降も追う具体的な未解決事項を提案する。実行中は保存せず、Event成功時だけ確定する。通常1件、明確に独立する場合でも合計3件程度まで。",
      schema: ConcernProposalSchema,
      resultPolicy: { kind: "standard", project: (value) => value },
      execute: (proposal) => success({ queued: true, proposal })
    },
    {
      name: "memory_search",
      description: "判断に必要な自分のMemoryだけを語句で検索し、短い要点を取得する。",
      schema: z.object({ query: z.string().trim().min(1).max(160).describe("探す出来事、対象、または判断材料"), subject: z.string().trim().min(1).max(120).optional().describe("関係主体で絞る場合のsubject ID"), limit: z.number().int().min(1).max(5).default(3).describe("返す最大件数") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ query, subject, limit }: { query: string; subject?: string; limit: number }, context) => {
        const rows = await pool.query<MemoryRow>(`SELECT DISTINCT m.id,m.content,m.importance,m.occurred_at
          FROM memories m LEFT JOIN memory_subjects ms ON ms.memory_id=m.id
          WHERE m.agent_id=$1 AND (m.content ILIKE '%'||$2||'%' OR m.importance ILIKE '%'||$2||'%') AND ($3::text IS NULL OR ms.subject_id=$3)
          ORDER BY m.occurred_at DESC,m.id LIMIT $4`, [context.agentId, query, subject ?? null, limit]);
        return success({ memories: rows.rows.map((row) => ({ id: row.id, summary: compact(row.content, 320), significance: compact(row.importance, 180), occurredAt: row.occurred_at.toISOString() })) });
      }
    },
    {
      name: "relationship_search",
      description: "特定の相手との現在のRelationshipを取得する。相手IDが不明なら短い語句でも検索できる。",
      schema: z.object({ subjectId: z.string().min(1).optional().describe("既知の相手ID"), query: z.string().trim().min(1).max(120).optional().describe("説明から探す語句"), limit: z.number().int().min(1).max(5).default(3).describe("返す最大件数") }).strict().refine((value) => value.subjectId !== undefined || value.query !== undefined, { message: "subjectId or query is required" }),
      resultPolicy: { kind: "standard" },
      execute: async ({ subjectId, query, limit }: { subjectId?: string; query?: string; limit: number }, context) => {
        const row = (await pool.query<StateRow>("SELECT concerns,relationships,mood FROM agent_states WHERE agent_id=$1", [context.agentId])).rows[0];
        const relationships = z.array(RelationshipSchema).parse(row?.relationships ?? []).filter((value) => subjectId !== undefined ? value.subjectId === subjectId : value.description.toLowerCase().includes((query ?? "").toLowerCase())).slice(0, limit).map((value) => ({ ...value, description: compact(value.description, 400) }));
        return success({ relationships });
      }
    },
    {
      name: "self_get",
      description: "現在のDisposition、Self Story、Commitments、Moodから、判断に必要な項目だけを取得する。",
      schema: z.object({ fields: z.array(z.enum(["disposition", "selfStory", "commitments", "mood"])).min(1).max(4).describe("必要なSelf項目") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ fields }: { fields: ("disposition" | "selfStory" | "commitments" | "mood")[] }, context) => {
        const row = (await pool.query<SelfRow>("SELECT a.identity,s.disposition,s.self_story,s.commitments,s.mood FROM agents a JOIN agent_states s ON s.agent_id=a.id WHERE a.id=$1", [context.agentId])).rows[0];
        if (row === undefined) return { ok: false, error: "Agent not found" };
        const self = SelfSchema.parse({ identity: row.identity, disposition: row.disposition, selfStory: row.self_story, commitments: row.commitments });
        const value: Record<string, unknown> = {};
        for (const field of fields) value[field] = field === "mood" ? compact(row.mood, 300) : field === "commitments" ? self.commitments.slice(0, 8).map((item) => compact(item, 240)) : compact(self[field], 800);
        return success(value);
      }
    }
  ];
}
