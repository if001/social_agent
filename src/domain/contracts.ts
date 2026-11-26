import { z } from "zod";

const Id = z.string().min(1);
const Instant = z.iso.datetime({ offset: true });
const NaturalLanguage = z.string().trim().min(1).max(16_000);
export const CurrentSelfIdentitySchema = NaturalLanguage.describe("Agentが自分が誰であるかを表す現在の自己認識。出来事の履歴、現在のTask、今回のDesireは書かない");
export const CurrentDispositionSchema = NaturalLanguage.describe("価値を感じやすい対象と意味づけの持続的な傾向。今回の出来事の結論や実行計画は書かない");
export const CurrentSelfStorySchema = z.string().trim().min(1).max(600).describe("現在の自己理解・継続する役割・現在の変化だけを表す。出来事の時系列、調査結果、完了済みTaskの履歴はMemoryへ残す");
export const CurrentCommitmentSchema = z.string().trim().min(1).max(400).describe("Selfが長期に守りたいもの、続けたい関係、または譲りたくないことを一つだけ表す。出来事の履歴はMemory、実行日時と仕事はScheduled Task、継続的な関心はConcern、今回のDesireは書かない");
export const CurrentCommitmentsSchema = z.array(CurrentCommitmentSchema).max(12).describe("全Eventで参照する、守りたいもの・続けたい関係・譲りたくないことからなる現在のCommitmentsの完全な配列。今回の差分や優先順位ではなく、残す全項目を最大12件で返す");
/**
 * Stored Self is deliberately more permissive than the model-facing writer.
 * A deployment can contain Self written before the current output bounds were
 * introduced; reading it must not stop ordinary Event processing.  Every
 * writer still uses SelfSchema below, so newly persisted values converge on
 * the bounded shape without silently rewriting old state during a read.
 */
export const PersistedCommitmentsSchema = z.array(NaturalLanguage).describe("永続化済みのCommitments。旧データを安全に読むため、writerより広い形を許す");
export const CurrentRelationshipDescriptionSchema = z.string().trim().min(1).max(400).describe("現在の関係の型、会話上の安定した前提、未解決の約束だけを表す。個別出来事や日付の列挙はMemoryへ残す");
const AgentDesire = z.string().trim().min(1).max(800);
const AgentContent = z.string().trim().min(1).max(6_000);
const AgentReason = z.string().trim().min(1).max(800);
const AgentStateDescription = z.string().trim().min(1).max(800);
const EventMeaning = z.string().trim().min(1).max(800).describe("今回のEventが自分にとって何を意味するかを、確認できる事実に基づき1〜2文で書く。感情、願望、計画、Actionは書かない。未返信・返答待ち・連投回避を待機や抑制の意味として書かない");
const EventFeeling = z.string().trim().min(1).max(160).describe("今回のEventで今生じた短期的な感情を、感情語中心の1文で書く。例: 喜び、期待、不安、落胆、苛立ち、怒り、驚き、警戒、安堵、退屈。例から選ぶ必要はない。Toolの失敗・探索結果・予測誤差への反応も書ける。Eventの説明、理由、願望、計画、Action、持続するMoodは書かない。未返信・返答待ち・連投回避を待機や抑制の感情として書かない");

/**
 * Mood is a compact, durable affective stance.  Its semantic boundary is an
 * LLM judgement; the schema intentionally enforces only the mechanical
 * shape and length limit shared by every writer.
 */
export const PersistentMoodDescription = "次の複数Eventの意味づけと行動の調子を変える、Agent自身の持続的な感情的構えを短い一文で書く。期待、苛立ち、警戒、退屈、安心など感情と傾きを中心にする。出来事、探索テーマ、固有名詞、ユーザー、返答待ち、約束、Concern、行動計画、願望、理由は書かない。持続する変化がなければ省略する。";
export const PersistentMoodSchema = z.string().trim().min(1).max(120).describe(PersistentMoodDescription);

export const PersistedSelfSchema = z.object({
  identity: CurrentSelfIdentitySchema,
  disposition: CurrentDispositionSchema,
  selfStory: CurrentSelfStorySchema,
  commitments: PersistedCommitmentsSchema
}).describe("永続化済みの現在Self。既存データを読むための互換形");
export type PersistedSelf = z.infer<typeof PersistedSelfSchema>;

/** Model-facing and write-side Self contract. */
export const SelfSchema = z.object({
  identity: CurrentSelfIdentitySchema,
  disposition: CurrentDispositionSchema,
  selfStory: CurrentSelfStorySchema,
  commitments: CurrentCommitmentsSchema
}).describe("Agent自身の比較的安定した現在の自己認識。通常Eventでは変更せず、Reflectionが十分なMemory根拠と理由を持つ場合だけ完全値で更新する");
export type Self = z.infer<typeof SelfSchema>;

export const ConcernSchema = z.object({
  id: Id.describe("Concernを同一Agent内で識別する安定したID"),
  description: NaturalLanguage.describe("気に掛け、今後進めたいことの具体的な内容"),
  whyItMatters: NaturalLanguage.describe("このConcernが現在のSelfにとって重要な理由"),
  status: z.enum(["active", "satisfied", "abandoned"]).describe("activeは継続中、satisfiedは満足して完了、abandonedは取り下げ")
}).describe("Agentが複数Eventにわたり持続して気に掛ける事項");
export type Concern = z.infer<typeof ConcernSchema>;

/** Model-facing and write-side Concern contract. Persisted legacy Concerns
 * remain readable through ConcernSchema and are compacted when rewritten. */
export const CurrentConcernDescriptionSchema = z.string().trim().min(1).max(400).describe("複数Eventにわたって残る、一つの持続する関心または動機の核。疑問文や解決可能な課題である必要はない。根拠の経緯、発見の列挙、会話ログ、実行日時、実行手順は含めない");
export const CurrentConcernImportanceSchema = z.string().trim().min(1).max(300).describe("その一つの持続する関心が、現在のSelf、感情、価値または関係にとって残る理由。根拠の経緯、実行手順、今回だけの行為は含めない");

export const ConcernActivityKindSchema = z.enum(["baseline", "created", "derived", "reviewed", "focused", "progressed", "status-changed", "presented", "removed", "closed"]);
export type ConcernActivityKind = z.infer<typeof ConcernActivityKindSchema>;

/**
 * Runtime-owned audit intent. The model never supplies activity IDs or
 * timestamps: persistence attaches those only when the State change commits.
 */
export const ConcernActivityIntentSchema = z.object({
  concernId: Id,
  kind: ConcernActivityKindSchema,
  eventId: Id,
  /** Only a derived Activity records lineage; this is never model supplied. */
  sourceConcernId: Id.optional(),
  /** Immutable explanation of why the child forked from its parent. */
  reason: z.string().trim().min(1).max(800).optional(),
  evidenceMemoryIds: z.array(Id).min(1).max(8).optional()
}).strict().superRefine((value, context) => {
  if (value.kind === "derived") {
    if (value.sourceConcernId === undefined) context.addIssue({ code: "custom", path: ["sourceConcernId"], message: "derived Activity requires a sourceConcernId" });
    if (value.reason === undefined) context.addIssue({ code: "custom", path: ["reason"], message: "derived Activity requires a reason" });
    if (value.evidenceMemoryIds === undefined) context.addIssue({ code: "custom", path: ["evidenceMemoryIds"], message: "derived Activity requires signal Memory evidence" });
    return;
  }
  if (value.sourceConcernId !== undefined) context.addIssue({ code: "custom", path: ["sourceConcernId"], message: "only derived Activity may have a sourceConcernId" });
  if (value.reason !== undefined) context.addIssue({ code: "custom", path: ["reason"], message: "only derived Activity may have a derivation reason" });
});
export type ConcernActivityIntent = z.infer<typeof ConcernActivityIntentSchema>;

export const ConcernProposalSchema = z.object({
  operation: z.enum(["create", "derive"]).describe("createは独立した新規Concern、deriveは既存Concernから生じた後続Concern。createはconcern-formationまたはidle、deriveはconcern-dueでのみ使う"),
  description: CurrentConcernDescriptionSchema,
  whyItMatters: CurrentConcernImportanceSchema,
  derivationReason: z.string().trim().min(1).max(800).optional().describe("derive時だけ、親Concernから別のConcernをforkする理由。子Concernが重要な理由（whyItMatters）や出来事のログではなく、今回の新しい経験が親の関心をなぜ別の持続的関心へ分けるかを短く書く。createでは指定しない"),
  explorationMode: z.enum(["deepen", "bridge", "distant"]).optional().describe("提案したConcernの探索の向き。deepenは同じ対象の深掘り、bridgeは性質を共有する別領域、distantは既存Focusから離れた具体対象への移動。exploration-domains候補はconcern-formationだけが受け取る"),
  transition: z.literal("fork").optional().describe("deriveは派生元を残して並行追跡するforkだけを許可する")
}).strict().superRefine((value, context) => {
  if (value.operation === "derive" && value.derivationReason === undefined) context.addIssue({ code: "custom", path: ["derivationReason"], message: "derive requires a derivationReason" });
  if (value.operation === "create" && value.derivationReason !== undefined) context.addIssue({ code: "custom", path: ["derivationReason"], message: "create must not have a derivationReason" });
}).describe("Agent実行中は永続化せず、成功したEvent commit時だけ適用するConcern提案。deriveの親はモデルがIDで指定せず、concern-dueの直前focusをRuntimeが結び付ける");
export type ConcernProposal = z.infer<typeof ConcernProposalSchema>;

/** Runtime-resolved proposal. Parent identifiers are never part of the model contract. */
export const ResolvedConcernProposalSchema = ConcernProposalSchema.extend({
  sourceConcernId: Id.optional(),
  /** Runtime-only signal Memory IDs; never exposed to the model. */
  evidenceMemoryIds: z.array(Id).min(1).max(8).optional()
}).strict().superRefine((value, context) => {
  if (value.operation === "derive" && value.sourceConcernId === undefined) context.addIssue({ code: "custom", path: ["sourceConcernId"], message: "derive requires a Runtime-resolved sourceConcernId" });
  if (value.operation === "derive" && value.evidenceMemoryIds === undefined) context.addIssue({ code: "custom", path: ["evidenceMemoryIds"], message: "derive requires Runtime-resolved signal Memory evidence" });
  if (value.operation === "create" && value.sourceConcernId !== undefined) context.addIssue({ code: "custom", path: ["sourceConcernId"], message: "create must not have a sourceConcernId" });
  if (value.operation === "create" && value.evidenceMemoryIds !== undefined) context.addIssue({ code: "custom", path: ["evidenceMemoryIds"], message: "create must not have Runtime-resolved signal Memory evidence" });
});
export type ResolvedConcernProposal = z.infer<typeof ResolvedConcernProposalSchema>;

export const RelationshipSchema = z.object({ subjectId: Id.describe("関係する相手を識別するID"), description: CurrentRelationshipDescriptionSchema }).describe("特定の相手との持続的な関係状態");
export type Relationship = z.infer<typeof RelationshipSchema>;

export const AgentStateSchema = z.object({
  // Keep legacy stored State readable. Every model-facing writer uses
  // PersistentMoodSchema above, so newly persisted Mood values are bounded.
  mood: NaturalLanguage.optional(),
  concerns: z.array(ConcernSchema),
  relationships: z.array(RelationshipSchema)
});
export type AgentState = z.infer<typeof AgentStateSchema>;
export const CurrentSelfSchema = PersistedSelfSchema.extend({ agentId: Id, version: z.number().int().nonnegative() });
export type CurrentSelf = z.infer<typeof CurrentSelfSchema>;
export const CurrentAgentStateSchema = AgentStateSchema.extend({ agentId: Id, updatedAt: Instant });
export type CurrentAgentState = z.infer<typeof CurrentAgentStateSchema>;

export const EpisodicMemorySchema = z.object({
  id: Id,
  summary: NaturalLanguage,
  significance: NaturalLanguage,
  subjects: z.array(Id),
  occurredAt: Instant,
  createdAt: Instant,
  source: NaturalLanguage.optional(),
  // Maintenance passes need the storage kind to apply its update rule.  It is
  // optional for older persisted Reflection inputs.
  kind: z.enum(["episodic", "semantic", "self-related", "self-change", "common-ground"]).optional(),
  evidenceEventIds: z.array(Id).max(16).optional()
});
export type EpisodicMemory = z.infer<typeof EpisodicMemorySchema>;

export const EventAssessmentSchema = z.object({
  meaning: EventMeaning.optional(),
  feeling: EventFeeling.optional()
}).strict().describe("今回のEvent処理終了時の主観的評価。Meaningと短期的なFeelingだけを扱う");
export type EventAssessment = z.infer<typeof EventAssessmentSchema>;
export const PreviousAssessmentSchema = EventAssessmentSchema.extend({
  occurredAt: Instant.describe("このAssessmentが確定したEventの発生時刻")
}).strict().describe("直近の成功Event終了時のAssessment。経過時間と現在Eventとの関連を踏まえ、残っている影響だけを使う");
export type PreviousAssessment = z.infer<typeof PreviousAssessmentSchema>;

export const PreviousDesireSchema = z.object({
  desire: AgentDesire.describe("直近の成功Eventで確定したDesire"),
  occurredAt: Instant.describe("このDesireが確定したEventの発生時刻")
}).strict().describe("直近の成功Eventで確定したDesire。経過時間と現在Eventとの関連を踏まえ、まだ現在の意図か判断する");
export type PreviousDesire = z.infer<typeof PreviousDesireSchema>;

export const RunLimitsSchema = z.object({
  deadlineMs: z.number().int().positive(),
  maxSteps: z.number().int().min(1).max(100),
  maxToolCalls: z.number().int().min(0).max(100),
  maxHops: z.number().int().min(0).max(32),
  maxAttempts: z.number().int().min(1).max(32)
});
export type RunLimits = z.infer<typeof RunLimitsSchema>;

export const AgentFamilySchema = z.object({
  id: Id,
  name: NaturalLanguage,
  sharedDisposition: NaturalLanguage
});

export const BotPersonaSchema = z.object({
  version: z.literal(1),
  identity: z.object({ displayName: NaturalLanguage, description: NaturalLanguage.optional() }),
  communication: z.object({
    language: NaturalLanguage.default("ja"),
    firstPerson: NaturalLanguage,
    tone: z.array(NaturalLanguage).min(1).max(12),
    responseStyle: z.array(NaturalLanguage).max(12).default([]),
    avoid: z.array(NaturalLanguage).max(12).default([])
  })
});
export type BotPersona = z.infer<typeof BotPersonaSchema>;

export const InitialSelfConfigSchema = z.object({
  version: z.literal(1),
  family: z.object({
    id: Id,
    name: NaturalLanguage,
    sharedDisposition: NaturalLanguage,
    baseInstruction: z.string().trim().max(16_000).default("")
  }),
  agent: z.object({
    id: Id,
    identity: NaturalLanguage,
    initialDisposition: NaturalLanguage,
    raisonDetre: NaturalLanguage.optional(),
    selfNarrative: NaturalLanguage,
    selfContinuity: NaturalLanguage
  }).strict(),
  initialState: z.object({
    mood: PersistentMoodSchema.default("静かな好奇心を保っている"),
    concerns: z.array(ConcernSchema).default([]),
    relationships: z.array(RelationshipSchema).default([])
  }).default({ mood: "静かな好奇心を保っている", concerns: [], relationships: [] })
});
export type InitialSelfConfig = z.infer<typeof InitialSelfConfigSchema>;

/** Construct the initial persisted Self through the same bounded writer
 * contract used by Reflection.  Initialization and reset must never bypass
 * the output boundary merely because their source is YAML rather than an LLM. */
export function initialSelfFromConfig(config: InitialSelfConfig): Self {
  return SelfSchema.parse({
    identity: config.agent.identity,
    disposition: [config.family.sharedDisposition, config.agent.initialDisposition].join("\n"),
    selfStory: [config.agent.selfNarrative, config.agent.selfContinuity].join("\n"),
    commitments: config.agent.raisonDetre === undefined ? [] : [config.agent.raisonDetre]
  });
}
/** `user-message` is retained solely to read records written before #062. */
export const EventKindSchema = z.enum(["message-received", "user-message", "tool-result", "time", "external", "internal", "system"]);
export const EventSchema = z.object({
  id: Id,
  agentId: Id,
  kind: EventKindSchema,
  occurredAt: Instant,
  payload: z.record(z.string(), z.unknown()),
  causationId: Id.optional(),
  correlationId: Id.optional()
});
export type DomainEvent = z.infer<typeof EventSchema>;

export const ScheduledTaskStatusSchema = z.enum(["scheduled", "running", "completed", "cancelled", "failed"]);
export const ScheduledTaskSchema = z.object({
  id: Id,
  agentId: Id,
  executeAt: Instant,
  instruction: NaturalLanguage,
  reason: NaturalLanguage.optional(),
  destination: NaturalLanguage.optional(),
  status: ScheduledTaskStatusSchema,
  attempt: z.number().int().nonnegative(),
  sourceEventId: Id,
  sourceRunId: Id,
  executionEventId: Id.optional(),
  createdAt: Instant,
  updatedAt: Instant
});
export type ScheduledTask = z.infer<typeof ScheduledTaskSchema>;

export const ObservationSchema = z.object({
  eventId: Id,
  summary: NaturalLanguage,
  facts: z.array(NaturalLanguage),
  observedAt: Instant,
  kind: EventKindSchema.optional(),
  actor: z.object({ id: Id, type: z.enum(["human", "agent", "tool", "system", "unknown"]) }).optional(),
  source: z.object({ type: z.enum(["terminal", "discord", "agent", "tool", "scheduler", "system", "unknown"]), id: Id.optional(), direct: z.boolean() }).optional(),
  content: z.unknown().optional(),
  context: z.record(z.string(), z.unknown()).optional(),
  provenance: z.record(z.string(), z.unknown()).optional(),
  causationId: Id.optional(),
  correlationId: Id.optional()
});
export type Observation = z.infer<typeof ObservationSchema>;

export const MemorySchema = z.object({
  id: Id,
  agentId: Id,
  kind: z.enum(["episodic", "semantic", "self-related", "self-change", "common-ground"]),
  content: NaturalLanguage,
  occurredAt: Instant,
  createdAt: Instant,
  relatedSubjectIds: z.array(Id),
  importance: NaturalLanguage,
  retrievalPriority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  sourceAgentId: Id.optional(),
  evidenceEventIds: z.array(Id)
});
export type Memory = z.infer<typeof MemorySchema>;

export const BackgroundPhaseSchema = z.enum(["最初期", "初期", "中期", "最近"]);
export type BackgroundPhase = z.infer<typeof BackgroundPhaseSchema>;

export const BackgroundProfileSchema = z.object({
  nature: z.literal("AI"),
  createdBy: z.literal("if001"),
  origin: NaturalLanguage,
  purpose: NaturalLanguage,
  experienceScope: z.array(NaturalLanguage).min(1).max(12),
  values: z.array(NaturalLanguage).min(1).max(12),
  recurringTopics: z.array(NaturalLanguage).max(20),
  communicationHabits: z.array(NaturalLanguage).max(20)
}).strict();
export type BackgroundProfile = z.infer<typeof BackgroundProfileSchema>;

export const BackgroundExperienceSchema = z.object({
  id: Id,
  agentId: Id,
  occurredAt: Instant,
  phase: BackgroundPhaseSchema,
  place: NaturalLanguage,
  participants: z.array(NaturalLanguage).max(12),
  relationship: NaturalLanguage,
  action: NaturalLanguage,
  feeling: NaturalLanguage,
  outcome: NaturalLanguage,
  lesson: NaturalLanguage,
  importance: NaturalLanguage,
  tags: z.array(NaturalLanguage).min(1).max(12)
}).strict();
export type BackgroundExperience = z.infer<typeof BackgroundExperienceSchema>;

export const BackgroundExperienceFileSchema = z.object({
  version: z.literal(1),
  agentId: Id,
  profile: BackgroundProfileSchema,
  experiences: z.array(BackgroundExperienceSchema.omit({ agentId: true })).min(1)
}).strict();
export type BackgroundExperienceFile = z.infer<typeof BackgroundExperienceFileSchema>;

export const RetrievalSourceSchema = z.enum(["conversation", "background"]);
export type RetrievalSource = z.infer<typeof RetrievalSourceSchema>;
export const RetrievalSignalSchema = z.enum(["vector", "keyword", "subject", "recency"]);
export type RetrievalSignal = z.infer<typeof RetrievalSignalSchema>;
export const RetrievedItemSchema = z.object({
  source: RetrievalSourceSchema,
  id: Id,
  kind: z.string().min(1),
  content: NaturalLanguage,
  occurredAt: Instant,
  importance: NaturalLanguage,
  matchedBy: z.array(RetrievalSignalSchema),
  finalRank: z.number().int().positive()
});
export type RetrievedItem = z.infer<typeof RetrievedItemSchema>;

export const MemoryRetrievalTraceSchema = z.object({
  memoryId: Id,
  finalRank: z.number().int().positive(),
  matchedBy: z.array(z.enum(["vector", "keyword", "subject", "recency"])),
  kind: MemorySchema.shape.kind,
  selected: z.boolean(),
  exclusionReason: z.enum(["rank-limit", "category-diversity", "context-budget", "recent-experience-duplicate"]).optional()
});
export type MemoryRetrievalTrace = z.infer<typeof MemoryRetrievalTraceSchema>;

export const RecentExperienceStepSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("tool"), name: Id, input: z.unknown(), result: z.unknown(), ok: z.boolean() }),
  z.object({ type: z.literal("action"), action: z.lazy(() => FinalActionSchema) }),
  z.object({ type: z.literal("failure"), reason: NaturalLanguage })
]);
export const RecentObservationSchema = z.object({
  summary: z.string().trim().min(1).max(800).describe("過去Eventから、今回の判断に再利用できる中心的な出来事を1〜2文で表したもの"),
  facts: z.array(z.string().trim().min(1).max(240)).max(4).describe("summaryと重複しない、次の判断に必要な具体的事実"),
  kind: EventKindSchema.optional().describe("観測元Eventの種類"),
  actor: z.object({ id: Id, type: z.enum(["human", "agent", "tool", "system", "unknown"]) }).optional().describe("次の判断で相手の識別が必要な場合の行為者"),
  source: z.object({ type: z.enum(["terminal", "discord", "agent", "tool", "scheduler", "system", "unknown"]), id: Id.optional(), direct: z.boolean() }).optional().describe("観測経路。UIや自律Eventの区別に用いる"),
  scheduler: z.object({
    targetKind: z.string().optional(),
    explorationCandidates: z.array(z.string().trim().min(1).max(120)).max(8).optional()
  }).optional().describe("concern-formation Eventが関心地図の幅を作るために受け取る探索候補")
}).strict().describe("Recent Experience専用の再判断材料。監査用メタデータや入力本文は含めない");
export type RecentObservation = z.infer<typeof RecentObservationSchema>;
export const RecentExperienceSchema = z.object({
  eventId: Id,
  runId: Id.optional(),
  agentId: Id,
  occurredAt: Instant,
  eventKind: EventKindSchema,
  observation: RecentObservationSchema,
  steps: z.array(RecentExperienceStepSchema),
  effect: z.enum(["reduced", "unchanged", "increased", "unknown"]).optional(),
  progressChanged: z.boolean()
});
export type RecentExperience = z.infer<typeof RecentExperienceSchema>;


const ResponseRecipient = z.enum(["user", "channel", "peer"]).describe("省略時はEventの発話元へreplyする。userはowner userへのmention、channelは非mention通常投稿、peerは現在のpeerへreplyする。自律Eventのpeer開始先はRuntimeがallowlistから決め、LLMはBot表示名やIDを指定しない");
export const FinalActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("respond").describe("現在の会話相手へのreply、owner user向け発話、又は共有channelへの通常投稿として本文を一度だけ返す場合に選ぶ"), content: AgentContent.describe("唯一の外部発話本文。内部判断や管理情報を含めず、personaの発話表現を適用する"), recipient: ResponseRecipient.optional() }).strict().describe("本文一つと配送先一つだけを持つ応答。recipient省略時はEvent発話元へreplyし、同時に複数配送しない"),
  z.object({
    type: z.literal("refuse").describe("依頼を拒否し、その旨を相手へ返す場合に選ぶ"),
    content: AgentContent.describe("相手へ配送する拒否の本文。personaの発話表現を適用し、内部の判断根拠は含めない"),
    reason: AgentReason.describe("依頼を断る内部の判断根拠。外部へそのまま配送しない"),
    basis: z.enum(["personality", "system"]).describe("拒否の根拠。personalityは自身の価値観、systemは実行制約")
  }).describe("依頼を拒否して説明を配送するAction"),
  z.object({
    type: z.literal("notify-no-execution").describe("自律Eventで具体的な実行を選ばずownerへ理由を通知する場合に選ぶ。発話を避けるための代替にしない"),
    content: AgentContent.describe("具体的な実行対象を選ばなかった判断と理由をownerへ通知する本文"),
    reason: AgentReason.describe("実行しないと判断した内部理由")
  }).describe("実行しない判断をownerへ通知するAction"),
  z.object({ type: z.literal("no-external-action").describe("今回は外部へ発話しないと判断した場合に選ぶ。idleの既定Actionにしない。peer/directでは会話目的が満たされ、新しい問い・事実・反論・依頼又は自分の動機がない時にも選べる。peer/observedではengage後にも、具体的な問い・実質的な差分・Concern又は約束の次行為・自発表現がなければ選べる"), reason: AgentReason.describe("今回は発話しない具体的理由。ユーザーからの返信待ちは理由にしてはならない。peer/direct又はpeer/observedでは、会話目的が満たされたこと又は具体的な発話動機がないことを示す") }).describe("外部発話を行わないAction")
]).describe("今回の動機に基づく最終行動");
export type FinalAction = z.infer<typeof FinalActionSchema>;
export const AgentActionSchema = FinalActionSchema;
export type AgentAction = FinalAction;

const ProposedConcernSchema = ConcernSchema.extend({ description: CurrentConcernDescriptionSchema, whyItMatters: CurrentConcernImportanceSchema });
const NewConcernSchema = z.object({
  description: CurrentConcernDescriptionSchema,
  whyItMatters: CurrentConcernImportanceSchema,
  status: z.literal("active").describe("新規Concernはactiveで作成する")
}).strict();
const ProposedRelationshipSchema = RelationshipSchema.extend({ description: AgentStateDescription });
export const ConcernChangeSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create").describe("通常Eventで新しい独立Concernを作成する"), concern: NewConcernSchema.describe("作成するConcern。IDはRuntimeが付与する") }),
  z.object({ operation: z.literal("upsert").describe("Concernを追加または更新する"), concern: ProposedConcernSchema.describe("追加または更新するConcernの完全な値") }),
  z.object({ operation: z.literal("remove").describe("Concernを削除する"), id: Id.describe("削除するConcernのID") })
]).describe("次のEventにも残すConcernの変更。変更不要なら出力しない");
export const RelationshipChangeSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("upsert").describe("Relationshipを追加または更新する"), relationship: ProposedRelationshipSchema.describe("追加または更新するRelationshipの完全な値") }),
  z.object({ operation: z.literal("remove").describe("Relationshipを削除する"), subjectId: Id.describe("削除するRelationshipの相手ID") })
]).describe("次のEventにも残すRelationshipの変更。変更不要なら出力しない");
export const MemoryPerspectiveSchema = z.enum(["user", "self"]).describe("このMemoryを誰の経験として保存するか。userは対話相手について確認できた事実、selfはAgent自身の探索・行動・判断から得た経験");
export const MemoryPurposeSchema = z.enum(["user-context", "self-guidance"]).describe("次回どの判断に使うMemoryか。user-contextは相手への自然な問いや関係の継続、self-guidanceはConcern・探索方法・自分の判断に使う");
export const MemoryProposalSchema = z.object({
  content: z.string().trim().min(1).max(800).describe("今回すぐ記憶候補として残す、1〜2文の具体的な要点。ユーザー事実と自分の探索経験を一つに混ぜない"),
  perspective: MemoryPerspectiveSchema,
  purpose: MemoryPurposeSchema
}).strict().superRefine((value, context) => {
  if (value.perspective === "user" && value.purpose !== "user-context") context.addIssue({ code: "custom", path: ["purpose"], message: "user perspective requires user-context purpose" });
  if (value.perspective === "self" && value.purpose !== "self-guidance") context.addIssue({ code: "custom", path: ["purpose"], message: "self perspective requires self-guidance purpose" });
}).describe("保存するMemoryの視点と再利用先。単発のTool失敗は実行記録に残るため、繰り返された経験や次の方法を変える学びとして残る場合だけselfで提案する");
export type MemoryProposal = z.infer<typeof MemoryProposalSchema>;
export const AgentTurnSchema = z.object({
  desire: AgentDesire.describe("現在のSelf、状態、Observation、前回Assessment、previousDesire、取得したContextとTool結果から生じた今回の具体的な現在のコミットメント。自律Eventでは探索対象を選んだ根拠をSelf、Concern、会話Memory、Background Experience、Mood、探索結果のいずれかへ辿れるようにする。Concernの言い換えにしない"),
  action: FinalActionSchema
}).strict();
export type AgentTurn = z.infer<typeof AgentTurnSchema>;

export const MemoryIntentTargetSchema = z.enum(["episodic", "semantic", "self-related", "self-change", "common-ground"]).describe("保存先Memoryのkind。RelationshipやConcernは含めない");
export const MemoryIntentSchema = z.object({
  content: NaturalLanguage.describe("次回以降の検索と判断で再利用する、具体的で短い経験の要点"),
  reason: NaturalLanguage.describe("この内容をMemoryとして残す理由。予測誤差や観測との関係を書く"),
  evidenceEventIds: z.array(Id).max(16).describe("このMemoryIntentの根拠となるEvent ID。入力に存在するIDだけを使う"),
  confidence: z.enum(["high", "medium", "low"]).describe("更新してよい確信度。確率値ではなく離散値"),
  target: MemoryIntentTargetSchema,
  perspective: MemoryPerspectiveSchema.default("self"),
  purpose: MemoryPurposeSchema.default("self-guidance")
}).strict().superRefine((value, context) => {
  if (value.perspective === "user" && value.purpose !== "user-context") context.addIssue({ code: "custom", path: ["purpose"], message: "user perspective requires user-context purpose" });
  if (value.perspective === "self" && value.purpose !== "self-guidance") context.addIssue({ code: "custom", path: ["purpose"], message: "self perspective requires self-guidance purpose" });
}).describe("予測誤差や観測から作成・更新したいMemoryの意図。視点と再利用先を明示し、operationや候補Indexは持たない");
export type MemoryIntent = z.infer<typeof MemoryIntentSchema>;

export const PredictionExpectationSchema = z.enum(["very_high", "high", "medium", "low", "very_low"]).describe("次ターンにこの候補が現れる期待度。確率値や校正済みスコアではなく離散値");
const PredictionCandidateBase = {
  candidateIndex: z.number().int().min(0).max(2).describe("このグループ内の候補位置。0始まりの構造的なIndexで、意味タグではない"),
  content: NaturalLanguage.describe("次ターンのユーザー発話として予測する自然言語の内容"),
  expectation: PredictionExpectationSchema,
  contextSummary: NaturalLanguage.describe("予測の前提にした話題、状況、関係の短い自然言語要約。タグにしない"),
  rationale: NaturalLanguage.describe("この予測を置いた根拠。観測、直近の会話、Memoryのどれに基づくかを書く")
};
export const G1PredictionCandidateSchema = z.object({ ...PredictionCandidateBase, feature: NaturalLanguage.describe("語彙、文法、表記、口調、言い回しのどの軸の予測か") }).strict().describe("G1の表層的な次発話予測候補");
export const G2PredictionCandidateSchema = z.object({ ...PredictionCandidateBase, speechAct: NaturalLanguage.describe("質問、同意、拒否、保留、話題転換などの会話行為") }).strict().describe("G2の意味・命題・会話行為の次発話予測候補");
export const PredictionEvaluationSchema = z.object({
  group: z.enum(["g1", "g2"]).describe("評価対象の予測グループ"),
  candidateIndex: z.number().int().min(0).max(2).describe("評価対象の候補位置"),
  match: z.enum(["primary", "alternative", "unexpected", "undecidable"]).describe("観測が予測候補に一致したか。候補外はunexpected、判断不能はundecidable"),
  surprise: z.enum(["none", "low", "medium", "high", "unknown"]).describe("予測と観測のずれの大きさ。離散値"),
  difference: NaturalLanguage.describe("予測と実際の観測の差異を自然言語で説明する"),
  interpretation: NaturalLanguage.describe("Agentが実際の発話をどう受け取ったか。観測事実と混ぜない"),
  uncertainty: NaturalLanguage.describe("解釈の不確実性。判断できない理由も書く"),
  attribution: NaturalLanguage.optional().describe("不一致の原因についての仮説。判断できない場合は省略する"),
  observed: NaturalLanguage.describe("実際に観測したユーザー発話の要点"),
  errorDirection: z.enum(["over", "under", "matched", "undecidable"]).describe("予測が観測より過大、過小、一致、判断不能のどれか"),
  effect: z.enum(["reduced", "unchanged", "increased", "unknown"]).describe("前ターンのActionがこの候補へ与えた影響。RuntimeがRecentExperienceへ投影する"),
  effectEvidence: NaturalLanguage.optional().describe("effectの根拠。効果を判断できない場合は省略する")
}).strict().describe("候補ごとの予測誤差評価。MeaningやFeelingは含めない");
export const PredictionOutputSchema = z.object({
  predictions: z.object({
    g1: z.object({ candidates: z.array(G1PredictionCandidateSchema).max(3).describe("G1の予測候補。0〜3件") }).strict(),
    g2: z.object({ candidates: z.array(G2PredictionCandidateSchema).max(3).describe("G2の予測候補。0〜3件") }).strict()
  }).strict().describe("G1/G2の予測。必ずg1とg2を持つobjectで、配列を直接置かない"),
  predictionEvaluations: z.array(PredictionEvaluationSchema).max(6).describe("前回予測の候補ごとの評価。前回予測がなければ空配列"),
  g3: z.object({
    needsG3: z.boolean().describe("G3で仮説を深掘りする必要があるか"),
    targetLayers: z.array(z.enum(["L4", "L5", "L6"])).max(3).default([]).describe("G3で深掘りする層。L4は意図、L5は知識・信念、L6は関係・個人傾向"),
    reason: NaturalLanguage.optional().describe("G3が必要な理由。不要なら省略する"),
    priority: z.enum(["high", "medium", "low"]).default("medium").describe("G3の優先度")
  }).strict().describe("G3起動判断")
}).strict().describe("G1/G2の1回の構造化出力。predictions.g1.candidatesとpredictions.g2.candidatesを必ず持つ");
export type PredictionOutput = z.infer<typeof PredictionOutputSchema>;

export const PredictionContextSchema = z.object({
  agentId: Id,
  previousPrediction: z.object({ id: Id, createdAt: Instant, output: PredictionOutputSchema }).optional(),
  g3Summary: NaturalLanguage.optional(),
  g3MemoryIntents: z.array(MemoryIntentSchema).max(5).default([]),
  recentExperienceEffect: z.object({ eventId: Id, effect: z.enum(["reduced", "unchanged", "increased", "unknown"]), evidence: NaturalLanguage.optional() }).optional(),
  memoryCandidates: z.array(RetrievedItemSchema).max(5).default([])
}).strict();
export type PredictionContext = z.infer<typeof PredictionContextSchema>;

export const G3HypothesisEvaluationSchema = z.object({
  statement: NaturalLanguage.describe("評価する前回仮説の内容"),
  status: z.enum(["supported", "contradicted", "undecidable"]).describe("仮説が支持されたか、反証されたか、判断不能か"),
  rationale: NaturalLanguage.describe("支持・反証・判断不能の理由")
}).strict().describe("前回仮説の評価");
export const G3OutputSchema = z.object({
  hypothesisEvaluations: z.array(G3HypothesisEvaluationSchema).max(6).describe("前回仮説の評価。仮説がなければ空配列"),
  newHypotheses: z.array(NaturalLanguage).max(5).describe("新しく立てた仮説"),
  findings: z.array(NaturalLanguage).max(5).describe("ToolやMemoryから得た調査結果"),
  memories: z.array(z.object({
    content: NaturalLanguage.describe("今後も再利用できる経験として残す短い内容。入力又はTool結果に根拠がある事実・経験だけを書く"),
    reason: NaturalLanguage.describe("この候補を残す理由。今回のObservation、予測評価、又はTool結果との関係を短く書く"),
    target: MemoryIntentTargetSchema,
    perspective: MemoryPerspectiveSchema
  }).strict()).max(3).describe("G3が意味づけたMemory候補。根拠Event、subject、更新対象はRuntimeが検索結果から解決する")
}).strict().describe("G3の構造化出力");
export type G3EvaluationOutput = z.infer<typeof G3OutputSchema>;

export const MemoryUpdatePayloadSchema = z.looseObject({
  sourceEventId: Id.optional(),
  sourceRunId: Id.optional(),
  sourceKind: z.enum(["agent-run", "experience-integration", "memory-update", "reflection-formation", "reflection-reconciliation"]).optional(),
  sourceId: Id.optional(),
  intents: z.array(MemoryIntentSchema).min(1).max(10),
  subjectsByIntent: z.array(z.array(Id)).optional(),
  sourceAgentIds: z.array(Id.optional()).optional(),
  formation: z.literal(true).optional()
});
export type MemoryUpdatePayload = z.infer<typeof MemoryUpdatePayloadSchema>;

export const AgentCoreInputSchema = z.object({
  run: z.object({
    runId: Id,
    eventId: Id,
    agentId: Id,
    occurredAt: Instant,
    transport: z.object({ hop: z.number().int().min(0).max(32), expiresAt: Instant, replyTo: Id.optional() }).optional()
  }),
  observation: ObservationSchema,
  previousAssessment: PreviousAssessmentSchema.optional(),
  previousDesire: PreviousDesireSchema.optional(),
  recentExperiences: z.array(RecentExperienceSchema).max(8).default([]),
  persona: BotPersonaSchema.optional(),
  currentSelf: CurrentSelfSchema,
  state: CurrentAgentStateSchema,
  memories: z.array(MemorySchema),
  memoryRetrievalTrace: z.array(MemoryRetrievalTraceSchema).default([]),
  predictionContext: PredictionContextSchema.optional(),
  conversation: z.object({
    goal: z.string().trim().min(1).max(400).describe("このreply chainで自分が得たい、確かめたい、伝えたい、又は変えたい安定した目的"),
    status: z.enum(["candidate", "active"]).describe("candidateは今回replyした時だけ開始し、activeは既存Conversationの継続"),
    counterpart: z.string().trim().min(1).max(120).optional().describe("自律的なpeer開始だけで使う自然言語の相手表示。IDや配送先ではない")
  }).strict().optional().describe("現在のreply chainに限るConversation Goal。別Conversationの履歴はMemory化されない限り含めない"),
  availableTools: z.array(z.object({ name: Id, description: NaturalLanguage, inputSchema: z.record(z.string(), z.unknown()) })),
  runtimeConstraints: z.array(NaturalLanguage),
  limits: RunLimitsSchema
}).strict().superRefine((value, context) => {
  const owners = [value.currentSelf.agentId, value.state.agentId, ...value.recentExperiences.map((item) => item.agentId), ...value.memories.map((item) => item.agentId)];
  if (owners.some((owner) => owner !== value.run.agentId)) context.addIssue({ code: "custom", message: "context contains data owned by another agent" });
  if (value.predictionContext !== undefined && value.predictionContext.agentId !== value.run.agentId) context.addIssue({ code: "custom", message: "prediction context belongs to another agent" });
});
export type AgentCoreInput = z.infer<typeof AgentCoreInputSchema>;

export const AgentCoreOutputSchema = AgentTurnSchema.describe("前回Assessmentと今回の経験を踏まえて決めたDesireと最終Action。Memory、Relationship、Moodの持続的更新は応答commit後のExperience Integrationが判断する");
export type AgentCoreOutput = z.infer<typeof AgentCoreOutputSchema>;


export const ToolExecutionRecordSchema = z.object({
  callId: Id,
  runId: Id,
  eventId: Id,
  name: Id,
  input: z.record(z.string(), z.unknown()),
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: NaturalLanguage.optional(),
  startedAt: Instant,
  finishedAt: Instant
}).superRefine((value, context) => {
  if (value.ok && value.error !== undefined) context.addIssue({ code: "custom", path: ["error"], message: "successful Tool execution cannot contain an error" });
  if (!value.ok && value.error === undefined) context.addIssue({ code: "custom", path: ["error"], message: "failed Tool execution requires an error" });
});
export type ToolExecutionRecord = z.infer<typeof ToolExecutionRecordSchema>;

export const AgentRunResultSchema = z.object({
  assessment: EventAssessmentSchema.optional(),
  output: AgentCoreOutputSchema,
  toolExecutions: z.array(ToolExecutionRecordSchema),
  concernProposals: z.array(ResolvedConcernProposalSchema).optional(),
  budget: z.object({
    limits: RunLimitsSchema.pick({ deadlineMs: true, maxSteps: true, maxToolCalls: true }),
    consumed: z.object({ modelCalls: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(), repairs: z.number().int().nonnegative() })
  }).optional()
});
export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;


export const MessageEnvelopeSchema = z.object({
  id: Id,
  destination: Id,
  source: Id,
  sentAt: Instant,
  availableAt: Instant,
  expiresAt: Instant,
  attempt: z.number().int().min(0).max(32),
  hop: z.number().int().min(0).max(32),
  correlationId: Id.optional(),
  causationId: Id.optional(),
  replyTo: z.string().min(1).optional(),
  payload: z.record(z.string(), z.unknown())
}).refine((value) => Date.parse(value.expiresAt) > Date.parse(value.sentAt), { message: "expiresAt must be after sentAt", path: ["expiresAt"] });
export type MessageEnvelope = z.infer<typeof MessageEnvelopeSchema>;

export type DomainErrorCode = "VALIDATION" | "CONFLICT" | "NOT_FOUND" | "TIMEOUT" | "ABORTED" | "EXTERNAL" | "LIMIT_EXCEEDED";
export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DomainError";
  }
}
