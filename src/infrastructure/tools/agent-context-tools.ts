import type { Pool, QueryResultRow } from "pg";
import { z } from "zod";

import type { RegisteredTool } from "../../application/tool-registry.js";
import { ConcernProposalSchema, ConcernSchema, RelationshipSchema, SelfSchema } from "../../domain/contracts.js";

type StateRow = QueryResultRow & { concerns: unknown; relationships: unknown; mood: string };
type SelfRow = QueryResultRow & { identity: string; disposition: string; self_story: string; commitments: unknown; mood: string };
type MemoryRow = QueryResultRow & { id: string; content: string; importance: string; occurred_at: Date };
type EventRow = QueryResultRow & { id: string; observation: unknown };
type ActionRow = QueryResultRow & { result: unknown };

const compact = (value: string, limit: number): string => value.length <= limit ? value : `${value.slice(0, limit)}…`;
const success = (value: unknown) => Promise.resolve({ ok: true as const, value });

function actorId(observation: unknown): string | undefined {
  if (typeof observation !== "object" || observation === null) return undefined;
  const actor = "actor" in observation ? observation.actor : undefined;
  if (typeof actor !== "object" || actor === null) return undefined;
  const id = "id" in actor ? actor.id : undefined;
  const type = "type" in actor ? actor.type : undefined;
  return typeof id === "string" && (type === "human" || type === "unknown") ? id : undefined;
}

function responseQuestion(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null || !("output" in result)) return undefined;
  const output = result.output;
  if (typeof output !== "object" || output === null || !("action" in output)) return undefined;
  const action = output.action;
  if (typeof action !== "object" || action === null || !("type" in action) || action.type !== "respond" || !("content" in action) || typeof action.content !== "string") return undefined;
  const questions = action.content.split(/(?<=[?？])/u).filter((part) => /[?？]/u.test(part));
  return questions.length === 0 ? undefined : compact(questions.at(-1)?.trim() ?? "", 180);
}

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
      name: "user_context_get",
      description: "対話相手について既に知っている事実、現在の関係、直近に尋ねた質問を小さく取得する。相手への質問前に重複と境界を確認する。",
      schema: z.object({ subjectId: z.string().trim().min(1).max(160).optional().describe("対象ユーザーのID。省略時は今回Eventの話者、いなければ直近の人間の話者") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ subjectId }: { subjectId?: string }, context) => {
        let resolvedSubjectId = subjectId;
        if (resolvedSubjectId === undefined && context.eventId !== undefined) {
          const current = await pool.query<EventRow>("SELECT id,observation FROM events WHERE id=$1 AND agent_id=$2", [context.eventId, context.agentId]);
          resolvedSubjectId = actorId(current.rows[0]?.observation);
        }
        if (resolvedSubjectId === undefined) {
          const recent = await pool.query<EventRow>("SELECT id,observation FROM events WHERE agent_id=$1 ORDER BY occurred_at DESC,id DESC LIMIT 32", [context.agentId]);
          resolvedSubjectId = recent.rows.map((row) => actorId(row.observation)).find((value) => value !== undefined);
        }
        if (resolvedSubjectId === undefined) return success({ subjectId: null, knownFacts: [], factCount: 0, recentlyAskedTopics: [] });

        const facts = await pool.query<MemoryRow>(`SELECT m.id,m.content,m.importance,m.occurred_at
          FROM memories m JOIN memory_subjects ms ON ms.memory_id=m.id
          WHERE m.agent_id=$1 AND ms.subject_id=$2
          ORDER BY m.occurred_at DESC,m.id DESC LIMIT 5`, [context.agentId, resolvedSubjectId]);
        const state = (await pool.query<StateRow>("SELECT concerns,relationships,mood FROM agent_states WHERE agent_id=$1", [context.agentId])).rows[0];
        const relationship = z.array(RelationshipSchema).parse(state?.relationships ?? []).find((value) => value.subjectId === resolvedSubjectId);
        const recentActions = await pool.query<ActionRow>(`SELECT r.result
          FROM agent_runs r JOIN events e ON e.id=r.event_id AND e.agent_id=r.agent_id
          WHERE r.agent_id=$1 AND e.observation #>> '{actor,id}'=$2 AND r.finished_at IS NOT NULL AND r.failure_reason IS NULL
          ORDER BY e.occurred_at DESC,e.id DESC,r.started_at DESC LIMIT 12`, [context.agentId, resolvedSubjectId]);
        const recentlyAskedTopics = recentActions.rows.flatMap((row) => { const question = responseQuestion(row.result); return question === undefined ? [] : [question]; }).slice(0, 3);
        return success({
          subjectId: resolvedSubjectId,
          knownFacts: facts.rows.map((row) => compact(row.content, 240)),
          factCount: facts.rows.length,
          ...(relationship === undefined ? {} : { relationshipSummary: compact(relationship.description, 300) }),
          recentlyAskedTopics
        });
      }
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
