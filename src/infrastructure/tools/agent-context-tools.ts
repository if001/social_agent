import type { Pool, QueryResultRow } from "pg";
import { z } from "zod";

import type { EventRetrievalService, RetrievalService } from "../../application/ports.js";
import type { RegisteredTool } from "../../application/tool-registry.js";
import { ConcernProposalSchema, ConcernSchema, RelationshipSchema, SelfSchema } from "../../domain/contracts.js";
import { PostgresRetrievalService } from "../persistence/postgres-retrieval-service.js";

type StateRow = QueryResultRow & { concerns: unknown; relationships: unknown; mood: string };
type SelfRow = QueryResultRow & { identity: string; disposition: string; self_story: string; commitments: unknown; mood: string };
type EventRow = QueryResultRow & { id: string; observation: unknown };
type ActionRow = QueryResultRow & { result: unknown };
type ConcernActivityRow = QueryResultRow & { concern_id: string; kind: string; occurred_at: Date; event_id: string | null; run_id: string | null; reflection_id: string | null; evidence_memory_ids: unknown };
type ConcernActivitySummaryRow = QueryResultRow & { concern_id: string; last_meaningful_at: Date | null };

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

export function createAgentContextTools(pool: Pool, retrievalService?: RetrievalService): readonly RegisteredTool[] {
  return [
    {
      name: "retrieval_search",
      description: "会話由来MemoryとBackground Experienceを、語句・subject・新しさ・意味の近さで横断検索する。Predictiveな仮説の確認や、過去の経験の参照に使う。",
      schema: z.object({
        query: z.string().trim().min(1).max(240).describe("探す出来事、対象、仮説、または判断材料"),
        scope: z.enum(["conversation", "background", "all"]).default("all").describe("検索対象。会話Memory、背景経験、または両方"),
        kinds: z.array(z.enum(["episodic", "semantic", "self-related", "self-change", "common-ground", "background"])).min(1).max(6).optional().describe("会話Memoryのkind、またはbackgroundで絞る"),
        subject: z.string().trim().min(1).max(120).optional().describe("関係主体で絞る場合のsubject ID"),
        limit: z.number().int().min(1).max(8).default(5).describe("返す最大件数")
      }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ query, scope, kinds, subject, limit }: { query: string; scope: "conversation" | "background" | "all"; kinds?: ("episodic" | "semantic" | "self-related" | "self-change" | "common-ground" | "background")[]; subject?: string; limit: number }, context) => {
        const service = retrievalService ?? new PostgresRetrievalService(pool);
        const items = await service.retrieve({ agentId: context.agentId, query, scope, ...(kinds === undefined ? {} : { kinds }), ...(subject === undefined ? {} : { subjectIds: [subject], subjectFilter: true }), limit });
        return success({ items: items.map((item) => ({ source: item.source, id: item.id, kind: item.kind, summary: compact(item.content, 400), importance: compact(item.importance, 180), occurredAt: item.occurredAt, matchedBy: item.matchedBy })) });
      }
    },
    {
      name: "concern_list",
      description: "自分のactive ConcernをFocus選択用の短い一覧で取得する。必要ならcursorで次ページを読む。stale順は長く進展していないもの、recent-progress順は最近動いたものを優先する。自律Eventではまずこれで1件を選ぶ。",
      schema: z.object({ limit: z.number().int().min(1).max(12).default(8).describe("返す最大件数"), cursor: z.number().int().min(0).default(0).describe("前回のnextCursor。最初は0"), order: z.enum(["stale", "recent-progress"]).default("stale").describe("一覧の並び順") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ limit, cursor, order }: { limit: number; cursor: number; order: "stale" | "recent-progress" }, context) => {
        const row = (await pool.query<StateRow>("SELECT concerns,relationships,mood FROM agent_states WHERE agent_id=$1", [context.agentId])).rows[0];
        const active = z.array(ConcernSchema).parse(row?.concerns ?? []).filter(({ status }) => status === "active");
        const activity = active.length === 0 ? [] : (await pool.query<ConcernActivitySummaryRow>("SELECT concern_id,max(occurred_at) FILTER (WHERE kind=ANY($2::text[])) AS last_meaningful_at FROM concern_activities WHERE agent_id=$1 AND concern_id=ANY($3::text[]) GROUP BY concern_id", [context.agentId, ["created", "derived", "reviewed", "focused", "progressed", "status-changed", "baseline"], active.map(({ id }) => id)])).rows;
        const lastMeaningful = new Map(activity.map((value) => [value.concern_id, value.last_meaningful_at?.toISOString()]));
        const concerns = active.sort((a, b) => {
          const aAt = lastMeaningful.get(a.id) ?? ""; const bAt = lastMeaningful.get(b.id) ?? "";
          return order === "stale" ? aAt.localeCompare(bAt) || a.id.localeCompare(b.id) : bAt.localeCompare(aAt) || a.id.localeCompare(b.id);
        });
        const values = concerns.slice(cursor, cursor + limit).map(({ id, description, reconsiderAt }) => ({ id, description: compact(description, 240), ...(reconsiderAt === undefined ? {} : { reconsiderAt }), ...(lastMeaningful.get(id) === undefined ? {} : { lastMeaningfulAt: lastMeaningful.get(id) }) }));
        return success({ count: active.length, concerns: values, ...(cursor + values.length < active.length ? { nextCursor: cursor + values.length } : {}) });
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
      name: "concern_history",
      description: "Focus候補のConcernについて、作成・派生・レビュー・進展・status変更・Reflectionでの提示という監査履歴と、その根拠Memoryを取得する。短い一覧で足りないときだけ使う。",
      schema: z.object({ concernId: z.string().min(1).describe("concern_listまたはconcern_getで得たConcern ID"), limit: z.number().int().min(1).max(20).default(12).describe("返す履歴の最大件数"), cursor: z.object({ occurredAt: z.iso.datetime({ offset: true }), id: z.string().min(1) }).strict().optional().describe("前回のnextCursor。同じ時刻のActivityも取りこぼさないため、そのまま渡す") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ concernId, limit, cursor }: { concernId: string; limit: number; cursor?: { occurredAt: string; id: string } }, context) => {
        const state = (await pool.query<StateRow>("SELECT concerns,relationships,mood FROM agent_states WHERE agent_id=$1", [context.agentId])).rows[0];
        if (!z.array(ConcernSchema).parse(state?.concerns ?? []).some(({ id }) => id === concernId)) return { ok: false, error: "Concern not found" };
        const activities = (await pool.query<ConcernActivityRow & { id: string }>(`SELECT id,concern_id,kind,occurred_at,event_id,run_id,reflection_id,evidence_memory_ids
          FROM concern_activities WHERE agent_id=$1 AND concern_id=$2 AND ($3::timestamptz IS NULL OR occurred_at<$3 OR (occurred_at=$3 AND id<$4))
          ORDER BY occurred_at DESC,id DESC LIMIT $5`, [context.agentId, concernId, cursor?.occurredAt ?? null, cursor?.id ?? null, limit])).rows;
        const evidenceIds = [...new Set(activities.flatMap(({ evidence_memory_ids }) => Array.isArray(evidence_memory_ids) ? evidence_memory_ids.filter((id): id is string => typeof id === "string") : []))];
        const memories = evidenceIds.length === 0 ? [] : (await pool.query<{ id: string; content: string; importance: string; occurred_at: Date }>("SELECT id,content,importance,occurred_at FROM memories WHERE agent_id=$1 AND id=ANY($2::text[]) ORDER BY occurred_at DESC,id LIMIT 20", [context.agentId, evidenceIds])).rows.map((memory) => ({ id: memory.id, summary: compact(memory.content, 320), importance: compact(memory.importance, 180), occurredAt: memory.occurred_at.toISOString() }));
        const history = activities.map((activity) => ({ kind: activity.kind, occurredAt: activity.occurred_at.toISOString(), ...(activity.event_id === null ? {} : { eventId: activity.event_id }), ...(activity.run_id === null ? {} : { runId: activity.run_id }), ...(activity.reflection_id === null ? {} : { reflectionId: activity.reflection_id }), evidenceMemoryIds: Array.isArray(activity.evidence_memory_ids) ? activity.evidence_memory_ids.filter((id): id is string => typeof id === "string") : [] }));
        const last = activities.at(-1);
        return success({ concernId, history, evidenceMemories: memories, ...(last === undefined ? {} : { nextCursor: { occurredAt: last.occurred_at.toISOString(), id: last.id } }) });
      }
    },
    {
      name: "concern_propose",
      description: "次回以降も気に掛けることを提案する。concern-formationはSelf・Memory・Background Experience・Relationshipまたは探索候補から独立Concernをcreateし、idleは行動中に強く残った独立Concernだけをcreateできる。concern-dueとexternal-changeは既存Concernから別の問い・対象・方法が残る場合だけderive + forkする。実行中は保存せず、Event成功時だけ確定する。通常1件、明確に独立する場合でも合計3件程度まで。",
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

        const service = retrievalService ?? new PostgresRetrievalService(pool);
        const facts = await service.retrieve({ agentId: context.agentId, query: "", scope: "conversation", subjectIds: [resolvedSubjectId], subjectFilter: true, limit: 5 });
        const state = (await pool.query<StateRow>("SELECT concerns,relationships,mood FROM agent_states WHERE agent_id=$1", [context.agentId])).rows[0];
        const relationship = z.array(RelationshipSchema).parse(state?.relationships ?? []).find((value) => value.subjectId === resolvedSubjectId);
        const recentActions = await pool.query<ActionRow>(`SELECT r.result
          FROM agent_runs r JOIN events e ON e.id=r.event_id AND e.agent_id=r.agent_id
          WHERE r.agent_id=$1 AND e.observation #>> '{actor,id}'=$2 AND r.finished_at IS NOT NULL AND r.failure_reason IS NULL
          ORDER BY e.occurred_at DESC,e.id DESC,r.started_at DESC LIMIT 12`, [context.agentId, resolvedSubjectId]);
        const recentlyAskedTopics = recentActions.rows.flatMap((row) => { const question = responseQuestion(row.result); return question === undefined ? [] : [question]; }).slice(0, 3);
        return success({
          subjectId: resolvedSubjectId,
          knownFacts: facts.map((item) => compact(item.content, 240)),
          factCount: facts.length,
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
        const service = retrievalService ?? new PostgresRetrievalService(pool);
        const items = await service.retrieve({ agentId: context.agentId, query, scope: "conversation", ...(subject === undefined ? {} : { subjectIds: [subject], subjectFilter: true }), limit });
        return success({ memories: items.map((item) => ({ id: item.id, summary: compact(item.content, 320), significance: compact(item.importance, 180), occurredAt: item.occurredAt })) });
      }
    },
    {
      name: "event_search",
      description: "過去Eventのprojectionを語句・subject・新しさ・意味の近さで局所検索する。Reflectionで既存Memoryの確認・訂正・矛盾の根拠を読むために使う。返されたEvent以外を根拠にしない。",
      schema: z.object({ query: z.string().trim().min(1).max(240).describe("確認または訂正したいMemoryに関係する語句"), subject: z.string().trim().min(1).max(120).optional().describe("関係主体で絞る場合のsubject ID"), kinds: z.array(z.string().trim().min(1).max(80)).max(8).optional().describe("Event kindで絞る場合の種類"), occurredAfter: z.iso.datetime({ offset: true }).optional().describe("この時刻以後のEventだけを読む"), occurredBefore: z.iso.datetime({ offset: true }).optional().describe("この時刻以前のEventだけを読む"), limit: z.number().int().min(1).max(16).default(8).describe("返す最大Event数") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ query, subject, kinds, occurredAfter, occurredBefore, limit }: { query: string; subject?: string; kinds?: string[]; occurredAfter?: string; occurredBefore?: string; limit: number }, context) => {
        const service = retrievalService instanceof PostgresRetrievalService ? retrievalService : new PostgresRetrievalService(pool);
        const events = await service.retrieveEvents({ agentId: context.agentId, query, ...(subject === undefined ? {} : { subjectIds: [subject] }), ...(kinds === undefined ? {} : { kinds }), ...(occurredAfter === undefined ? {} : { occurredAfter }), ...(occurredBefore === undefined ? {} : { occurredBefore }), limit });
        return success({ events: events.map((event) => ({ ...event, summary: compact(event.content, 500) })) });
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
