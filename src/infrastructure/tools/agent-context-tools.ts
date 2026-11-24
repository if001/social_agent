import { z } from "zod";

import type { EventRetrievalInput, RetrievedEvent, RetrievalInput } from "../../application/ports.js";
import { userMainSubjectId, type CanonicalSubjectResolver } from "../../application/canonical-subject.js";
import type { RegisteredTool } from "../../application/tool-registry.js";
import { ConcernProposalSchema, ConcernSchema, PersistedSelfSchema, RelationshipSchema, type Observation, type RetrievedItem } from "../../domain/contracts.js";
export type AgentContextState = { readonly concerns: unknown; readonly relationships: unknown; readonly mood: string };
export type ConcernActivity = { readonly id: string; readonly kind: string; readonly occurredAt: Date; readonly eventId: string | null; readonly runId: string | null; readonly reflectionId: string | null; readonly sourceConcernId: string | null; readonly reason: string | null; readonly evidenceMemoryIds: unknown };
export type EvidenceMemory = { readonly id: string; readonly content: string; readonly importance: string; readonly occurredAt: Date };
export type ToolExecutionObservation = { readonly tool: string; readonly result: unknown; readonly error: string | null; readonly finishedAt: Date };
export type AgentSelfState = { readonly identity: string; readonly disposition: string; readonly selfStory: string; readonly commitments: unknown; readonly mood: string };
export type ConcernDueFocus = { readonly concernId: string; readonly description: string; readonly whyItMatters: string; readonly sourceMemories: readonly { readonly id: string; readonly content: string; readonly importance: string; readonly occurredAt: Date }[] };

const compact = (value: string, limit: number): string => value.length <= limit ? value : `${value.slice(0, limit)}…`;
const success = (value: unknown) => Promise.resolve({ ok: true as const, value });

function responseQuestion(result: unknown): string | undefined {
  if (typeof result !== "object" || result === null || !("output" in result)) return undefined;
  const output = result.output;
  if (typeof output !== "object" || output === null || !("action" in output)) return undefined;
  const action = output.action;
  if (typeof action !== "object" || action === null || !("type" in action) || action.type !== "respond" || !("content" in action) || typeof action.content !== "string") return undefined;
  const questions = action.content.split(/(?<=[?？])/u).filter((part) => /[?？]/u.test(part));
  return questions.length === 0 ? undefined : compact(questions.at(-1)?.trim() ?? "", 180);
}

export interface AgentContextToolRepository {
  retrieve(input: RetrievalInput): Promise<readonly RetrievedItem[]>;
  retrieveEvents(input: EventRetrievalInput): Promise<readonly RetrievedEvent[]>;
  loadState(agentId: string): Promise<AgentContextState | undefined>;
  listConcernActivityTimes(agentId: string, concernIds: readonly string[]): Promise<ReadonlyMap<string, Date>>;
  listConcernActivities(agentId: string, concernId: string, cursor: { readonly occurredAt: string; readonly id: string } | undefined, limit: number): Promise<readonly ConcernActivity[]>;
  listEvidenceMemories(agentId: string, ids: readonly string[], limit: number): Promise<readonly EvidenceMemory[]>;
  findEventActor(agentId: string, eventId: string): Promise<Observation["actor"] | undefined>;
  findRecentHumanActor(agentId: string, limit: number): Promise<Observation["actor"] | undefined>;
  listRecentActionResults(agentId: string, actorIds: readonly string[], limit: number): Promise<readonly unknown[]>;
  listToolExecutions(agentId: string, eventId: string, limit: number): Promise<readonly ToolExecutionObservation[]>;
  loadSelf(agentId: string): Promise<AgentSelfState | undefined>;
  nextConcernDueFocus(agentId: string, signalClaimedAt: string | undefined, excludedConcernIds: readonly string[]): Promise<ConcernDueFocus | undefined>;
}
const currentUserSubject = z.literal("current-user").describe("現在会話しているユーザーだけに絞る。IDは指定しない");
const noSubjects: CanonicalSubjectResolver = { resolve: () => undefined, actorIdsFor: () => [] };

export function createAgentContextTools(repository: AgentContextToolRepository, subjects: CanonicalSubjectResolver = noSubjects): readonly RegisteredTool[] {
  return [
    {
      name: "retrieval_search",
      description: "会話由来MemoryとBackground Experienceを、語句・subject・新しさ・意味の近さで横断検索する。Predictiveな仮説の確認や、過去の経験の参照に使う。",
      schema: z.object({
        query: z.string().trim().min(1).max(240).describe("探す出来事、対象、仮説、または判断材料"),
        scope: z.enum(["conversation", "background", "all"]).default("all").describe("検索対象。会話Memory、背景経験、または両方"),
        kinds: z.array(z.enum(["episodic", "semantic", "self-related", "self-change", "common-ground", "background"])).min(1).max(6).optional().describe("会話Memoryのkind、またはbackgroundで絞る"),
        subject: currentUserSubject.optional(),
        limit: z.number().int().min(1).max(8).default(5).describe("返す最大件数")
      }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ query, scope, kinds, subject, limit }: { query: string; scope: "conversation" | "background" | "all"; kinds?: ("episodic" | "semantic" | "self-related" | "self-change" | "common-ground" | "background")[]; subject?: "current-user"; limit: number }, context) => {
        const subjectId = subject === undefined ? undefined : userMainSubjectId;
        const items = await repository.retrieve({ agentId: context.agentId, query, scope, ...(kinds === undefined ? {} : { kinds }), ...(subjectId === undefined ? {} : { subjectIds: [subjectId], subjectFilter: true }), limit });
        return success({ items: items.map((item) => ({ source: item.source, id: item.id, kind: item.kind, summary: compact(item.content, 400), importance: compact(item.importance, 180), occurredAt: item.occurredAt, matchedBy: item.matchedBy })) });
      }
    },
    {
      name: "concern_list",
      description: "自分のactive ConcernをFocus選択用の短い一覧で取得する。必要ならcursorで次ページを読む。stale順は長く進展していないもの、recent-progress順は最近動いたものを優先する。自律Eventではまずこれで1件を選ぶ。",
      schema: z.object({ limit: z.number().int().min(1).max(12).default(8).describe("返す最大件数"), cursor: z.number().int().min(0).default(0).describe("前回のnextCursor。最初は0"), order: z.enum(["stale", "recent-progress"]).default("stale").describe("一覧の並び順") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ limit, cursor, order }: { limit: number; cursor: number; order: "stale" | "recent-progress" }, context) => {
        const row = await repository.loadState(context.agentId);
        const active = z.array(ConcernSchema).parse(row?.concerns ?? []).filter(({ status }) => status === "active");
        const activity = active.length === 0 ? new Map<string, Date>() : await repository.listConcernActivityTimes(context.agentId, active.map(({ id }) => id));
        const lastMeaningful = new Map([...activity].map(([id, value]) => [id, value.toISOString()]));
        const concerns = active.sort((a, b) => {
          const aAt = lastMeaningful.get(a.id) ?? ""; const bAt = lastMeaningful.get(b.id) ?? "";
          return order === "stale" ? aAt.localeCompare(bAt) || a.id.localeCompare(b.id) : bAt.localeCompare(aAt) || a.id.localeCompare(b.id);
        });
        const values = concerns.slice(cursor, cursor + limit).map(({ id, description }) => ({ id, description: compact(description, 240), ...(lastMeaningful.get(id) === undefined ? {} : { lastMeaningfulAt: lastMeaningful.get(id) }) }));
        return success({ count: active.length, concerns: values, ...(cursor + values.length < active.length ? { nextCursor: cursor + values.length } : {}) });
      }
    },
    {
      name: "concern_get",
      description: "選んだFocus Concern 1件の内容を取得する。1 EventではFocusを1件だけにする。",
      schema: z.object({ concernId: z.string().min(1).describe("concern_listで得たConcern ID") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ concernId }: { concernId: string }, context) => {
        const row = await repository.loadState(context.agentId);
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
        const state = await repository.loadState(context.agentId);
        if (!z.array(ConcernSchema).parse(state?.concerns ?? []).some(({ id }) => id === concernId)) return { ok: false, error: "Concern not found" };
        const activities = await repository.listConcernActivities(context.agentId, concernId, cursor, limit);
        const evidenceIds = [...new Set(activities.flatMap(({ evidenceMemoryIds }) => Array.isArray(evidenceMemoryIds) ? evidenceMemoryIds.filter((id): id is string => typeof id === "string") : []))];
        const memories = (await repository.listEvidenceMemories(context.agentId, evidenceIds, 20)).map((memory) => ({ id: memory.id, summary: compact(memory.content, 320), importance: compact(memory.importance, 180), occurredAt: memory.occurredAt.toISOString() }));
        const history = activities.map((activity) => ({ kind: activity.kind, occurredAt: activity.occurredAt.toISOString(), ...(activity.eventId === null ? {} : { eventId: activity.eventId }), ...(activity.runId === null ? {} : { runId: activity.runId }), ...(activity.reflectionId === null ? {} : { reflectionId: activity.reflectionId }), evidenceMemoryIds: Array.isArray(activity.evidenceMemoryIds) ? activity.evidenceMemoryIds.filter((id): id is string => typeof id === "string") : [] }));
        const last = activities.at(-1);
        return success({ concernId, history, evidenceMemories: memories, ...(last === undefined ? {} : { nextCursor: { occurredAt: last.occurredAt.toISOString(), id: last.id } }) });
      }
    },
    {
      name: "concern_due_focus",
      description: "concern-due専用。signalになった新しい経験に関連するactive Concernを一件だけ読む。ID・候補番号は扱わない。最初はinitial、別の候補も検討したい時だけanotherを使う。",
      schema: z.object({ mode: z.enum(["initial", "another"]).default("initial").describe("最初の候補か、既に読んだ候補と別の候補か") }).strict(),
      resultPolicy: { kind: "standard", project: (value) => value },
      execute: async (_input, context) => {
        if (context.concernDue === undefined) return { ok: false, error: "concern_due_focus is only available during concern-due" };
        const focus = await repository.nextConcernDueFocus(context.agentId, context.concernDue.signalClaimedAt, context.concernDue.focusedConcernIds);
        return focus === undefined ? success({ available: false }) : success({ available: true, concernId: focus.concernId, evidenceMemoryIds: focus.sourceMemories.map(({ id }) => id), concern: { description: compact(focus.description, 400), whyItMatters: compact(focus.whyItMatters, 300) }, triggerExperiences: focus.sourceMemories.map((memory) => ({ summary: compact(memory.content, 320), importance: compact(memory.importance, 180), occurredAt: memory.occurredAt.toISOString() })) });
      }
    },
    {
      name: "concern_propose",
      description: "複数Eventにわたり残る一つの関心または動機の核を提案する。出来事の経緯、発見の列挙、今回だけの行為、実行日時、詳細手順は含めない。concern-formationはSelf・Memory・Background Experience・Relationshipまたは探索候補から独立Concernをcreateし、idleは行動中に強く残った独立Concernだけをcreateできる。concern-dueは既存Concernから別の関心が残る場合だけderive + forkする。実行中は保存せず、Event成功時だけ確定する。通常1件、明確に独立する場合でも合計3件程度まで。",
      schema: ConcernProposalSchema,
      resultPolicy: { kind: "standard", project: (value) => value },
      execute: (proposal) => success({ queued: true, proposal })
    },
    {
      name: "interaction_context_get",
      description: "現在の対話相手について既に知っている事実、現在の関係、直近に尋ねた質問を小さく取得する。humanとallowlist peerのどちらにも現在Eventの相手だけを返す。相手への質問前に重複と境界を確認する。",
      schema: z.object({}).strict(),
      resultPolicy: { kind: "standard" },
      execute: async (_input: Record<string, never>, context) => {
        const eventActor = context.eventId === undefined ? undefined : await repository.findEventActor(context.agentId, context.eventId);
        const recentActor = eventActor === undefined ? await repository.findRecentHumanActor(context.agentId, 32) : undefined;
        const resolvedSubjectId = subjects.resolve(eventActor ?? recentActor);
        if (resolvedSubjectId === undefined) return success({ knownFacts: [], factCount: 0, recentlyAskedTopics: [] });

        const facts = await repository.retrieve({ agentId: context.agentId, query: "", scope: "conversation", subjectIds: [resolvedSubjectId], subjectFilter: true, limit: 5 });
        const state = await repository.loadState(context.agentId);
        const relationship = z.array(RelationshipSchema).parse(state?.relationships ?? []).find((value) => value.subjectId === resolvedSubjectId);
        const recentActions = await repository.listRecentActionResults(context.agentId, subjects.actorIdsFor(resolvedSubjectId), 12);
        const recentlyAskedTopics = recentActions.flatMap((result) => { const question = responseQuestion(result); return question === undefined ? [] : [question]; }).slice(0, 3);
        return success({
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
      schema: z.object({ query: z.string().trim().min(1).max(160).describe("探す出来事、対象、または判断材料"), subject: currentUserSubject.optional(), limit: z.number().int().min(1).max(5).default(3).describe("返す最大件数") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ query, subject, limit }: { query: string; subject?: "current-user"; limit: number }, context) => {
        const items = await repository.retrieve({ agentId: context.agentId, query, scope: "conversation", ...(subject === undefined ? {} : { subjectIds: [userMainSubjectId], subjectFilter: true }), limit });
        return success({ memories: items.map((item) => ({ id: item.id, summary: compact(item.content, 320), significance: compact(item.importance, 180), occurredAt: item.occurredAt })) });
      }
    },
    {
      name: "event_search",
      description: "過去の主Event Experienceのprojectionを語句・subject・新しさ・意味の近さで局所検索する。Tool結果単体は監査用であり返さない。Reflectionで既存Memoryの確認・訂正・矛盾の根拠を読むために使う。返されたEvent以外を根拠にしない。",
      schema: z.object({ query: z.string().trim().min(1).max(240).describe("確認または訂正したいMemoryに関係する語句"), subject: currentUserSubject.optional(), kinds: z.array(z.string().trim().min(1).max(80)).max(8).optional().describe("Event kindで絞る場合の種類"), occurredAfter: z.iso.datetime({ offset: true }).optional().describe("この時刻以後のEventだけを読む"), occurredBefore: z.iso.datetime({ offset: true }).optional().describe("この時刻以前のEventだけを読む"), limit: z.number().int().min(1).max(16).default(8).describe("返す最大Event数") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ query, subject, kinds, occurredAfter, occurredBefore, limit }: { query: string; subject?: "current-user"; kinds?: string[]; occurredAfter?: string; occurredBefore?: string; limit: number }, context) => {
        const events = await repository.retrieveEvents({ agentId: context.agentId, query, ...(subject === undefined ? {} : { subjectIds: [userMainSubjectId] }), ...(kinds === undefined ? {} : { kinds }), ...(occurredAfter === undefined ? {} : { occurredAfter }), ...(occurredBefore === undefined ? {} : { occurredBefore }), limit });
        return success({ events: events.map((event) => ({ ...event, summary: compact(event.content, 500) })) });
      }
    },
    {
      name: "event_tool_results_get",
      description: "指定した親Eventで実行されたTool観測を監査目的でだけ取得する。通常の探索やMemory根拠には使わず、event_searchの代わりにも使わない。",
      schema: z.object({ eventId: z.string().trim().min(1).max(160).describe("親EventのID"), limit: z.number().int().min(1).max(20).default(12).describe("返す最大Tool実行数") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ eventId, limit }: { eventId: string; limit: number }, context) => {
        const rows = await repository.listToolExecutions(context.agentId, eventId, limit);
        return success({ eventId, toolExecutions: rows.map((row) => ({ tool: row.tool, ok: row.error === null, ...(row.error === null ? { result: row.result } : { error: row.error }), finishedAt: row.finishedAt.toISOString() })) });
      }
    },
    {
      name: "relationship_search",
      description: "現在のユーザーとのRelationshipを取得する。IDは扱わず、必要なら短い語句で説明を絞る。",
      schema: z.object({ query: z.string().trim().min(1).max(120).optional().describe("関係の説明から絞る語句"), limit: z.number().int().min(1).max(1).default(1).describe("返す最大件数") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ query, limit }: { query?: string; limit: number }, context) => {
        const row = await repository.loadState(context.agentId);
        const relationships = z.array(RelationshipSchema).parse(row?.relationships ?? []).filter((value) => value.subjectId === userMainSubjectId && (query === undefined || value.description.toLowerCase().includes(query.toLowerCase()))).slice(0, limit).map((value) => ({ description: compact(value.description, 400) }));
        return success({ relationships });
      }
    },
    {
      name: "self_get",
      description: "現在のDisposition、Self Story、Commitments、Moodから、判断に必要な項目だけを取得する。",
      schema: z.object({ fields: z.array(z.enum(["disposition", "selfStory", "commitments", "mood"])).min(1).max(4).describe("必要なSelf項目") }).strict(),
      resultPolicy: { kind: "standard" },
      execute: async ({ fields }: { fields: ("disposition" | "selfStory" | "commitments" | "mood")[] }, context) => {
        const row = await repository.loadSelf(context.agentId);
        if (row === undefined) return { ok: false, error: "Agent not found" };
        const self = PersistedSelfSchema.parse({ identity: row.identity, disposition: row.disposition, selfStory: row.selfStory, commitments: row.commitments });
        const value: Record<string, unknown> = {};
        for (const field of fields) value[field] = field === "mood" ? compact(row.mood, 300) : field === "commitments" ? self.commitments.slice(0, 8).map((item) => compact(item, 240)) : compact(self[field], 800);
        return success(value);
      }
    }
  ];
}
