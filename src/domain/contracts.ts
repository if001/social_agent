import { z } from "zod";

const Id = z.string().min(1);
const Instant = z.iso.datetime({ offset: true });
const NaturalLanguage = z.string().trim().min(1).max(16_000);
const AgentDesire = z.string().trim().min(1).max(800);
const AgentContent = z.string().trim().min(1).max(6_000);
const AgentReason = z.string().trim().min(1).max(800);
const AgentMood = z.string().trim().min(1).max(400);
const AgentStateDescription = z.string().trim().min(1).max(800);

export const SelfSchema = z.object({
  identity: NaturalLanguage,
  disposition: NaturalLanguage,
  selfStory: NaturalLanguage,
  commitments: z.array(NaturalLanguage)
});
export type Self = z.infer<typeof SelfSchema>;

export const ConcernSchema = z.object({
  id: Id.describe("Concernを同一Agent内で識別する安定したID"),
  description: NaturalLanguage.describe("気に掛け、今後進めたいことの具体的な内容"),
  whyItMatters: NaturalLanguage.describe("このConcernが現在のSelfにとって重要な理由"),
  status: z.enum(["active", "satisfied", "abandoned"]).describe("activeは継続中、satisfiedは満足して完了、abandonedは取り下げ"),
  reconsiderAt: Instant.describe("Concernを再検討するISO 8601日時。明確な時刻がある場合だけ指定する").optional()
}).describe("Agentが複数Eventにわたり持続して気に掛ける事項");
export type Concern = z.infer<typeof ConcernSchema>;

export const ConcernProposalSchema = z.object({
  operation: z.enum(["create", "derive"]).describe("createは独立した新規Concern、deriveは既存Concernから生じた後続Concern"),
  description: z.string().trim().min(1).max(400).describe("次に何を明らかにする、試す、または確認するかを、対象と行為が分かる一文で書く"),
  whyItMatters: z.string().trim().min(1).max(400).describe("得られた結果をどの判断、行動、会話、またはConcern解決に使うかを一文で書く"),
  sourceConcernId: Id.optional().describe("derive時の派生元Concern ID"),
  explorationMode: z.enum(["deepen", "bridge", "distant"]).optional().describe("deepenは同じ対象の深掘り、bridgeは性質を共有する別領域、distantは経験の薄い領域への移動"),
  transition: z.enum(["replace", "fork"]).optional().describe("replaceは派生元を閉じて置換、forkは派生元を残して並行追跡"),
  reconsiderAt: Instant.optional().describe("再検討すべき具体的な将来時刻がある場合だけ指定する")
}).strict().superRefine((value, context) => {
  if (value.operation === "derive" && value.sourceConcernId === undefined) context.addIssue({ code: "custom", path: ["sourceConcernId"], message: "derive requires sourceConcernId" });
  if (value.operation === "create" && value.sourceConcernId !== undefined) context.addIssue({ code: "custom", path: ["sourceConcernId"], message: "create must not specify sourceConcernId" });
}).describe("Agent実行中は永続化せず、成功したEvent commit時だけ適用するConcern提案");
export type ConcernProposal = z.infer<typeof ConcernProposalSchema>;

export const RelationshipSchema = z.object({ subjectId: Id.describe("関係する相手を識別するID"), description: NaturalLanguage.describe("現在の関係性について経験に基づき保持する簡潔な記述") }).describe("特定の相手との持続的な関係状態");
export type Relationship = z.infer<typeof RelationshipSchema>;

export const AgentStateSchema = z.object({
  mood: NaturalLanguage.optional(),
  concerns: z.array(ConcernSchema),
  relationships: z.array(RelationshipSchema)
});
export type AgentState = z.infer<typeof AgentStateSchema>;
export const CurrentSelfSchema = SelfSchema.extend({ agentId: Id, version: z.number().int().nonnegative() });
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
  source: NaturalLanguage.optional()
});
export type EpisodicMemory = z.infer<typeof EpisodicMemorySchema>;

export const EventAssessmentSchema = z.object({ meaning: NaturalLanguage.optional(), feeling: NaturalLanguage.optional() });
export type EventAssessment = z.infer<typeof EventAssessmentSchema>;

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
    mood: NaturalLanguage.default("特定の持続的な気分はまだ形成されていない"),
    concerns: z.array(ConcernSchema).default([]),
    relationships: z.array(RelationshipSchema).default([])
  }).default({ mood: "特定の持続的な気分はまだ形成されていない", concerns: [], relationships: [] })
});
export type InitialSelfConfig = z.infer<typeof InitialSelfConfigSchema>;
export const EventKindSchema = z.enum(["user-message", "tool-result", "time", "external", "internal", "system"]);
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
  kind: z.enum(["episodic", "semantic", "self-related", "self-change"]),
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
  }).optional().describe("自律Eventの継続性を判断するために必要な探索条件")
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
  progressChanged: z.boolean()
});
export type RecentExperience = z.infer<typeof RecentExperienceSchema>;


export const FinalActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("respond").describe("ユーザーまたは他Agentへ本文を返す場合に選ぶ"), content: AgentContent.describe("相手へそのまま配送する最終応答。内部判断や管理情報を含めず、personaの発話表現を適用する") }).describe("相手へ通常の応答を配送するAction"),
  z.object({
    type: z.literal("refuse").describe("依頼を拒否し、その旨を相手へ返す場合に選ぶ"),
    content: AgentContent.describe("相手へ配送する拒否の本文。personaの発話表現を適用し、内部の判断根拠は含めない"),
    reason: AgentReason.describe("依頼を断る内部の判断根拠。外部へそのまま配送しない"),
    basis: z.enum(["personality", "system"]).describe("拒否の根拠。personalityは自身の価値観、systemは実行制約")
  }).describe("依頼を拒否して説明を配送するAction"),
  z.object({
    type: z.literal("notify-no-execution").describe("自律Eventで具体的な実行を選ばずownerへ理由を通知する場合に選ぶ"),
    content: AgentContent.describe("具体的な実行対象を選ばなかった判断と理由をownerへ通知する本文"),
    reason: AgentReason.describe("実行しないと判断した内部理由")
  }).describe("実行しない判断をownerへ通知するAction"),
  z.object({ type: z.literal("no-external-action").describe("今回はユーザーへ発話しないと判断した場合に選ぶ"), reason: AgentReason.describe("今回は発話しない具体的理由。ユーザーからの返信待ちは理由にしてはならない") }).describe("外部発話を行わないAction")
]).describe("今回の動機に基づく最終行動");
export type FinalAction = z.infer<typeof FinalActionSchema>;
export const AgentActionSchema = FinalActionSchema;
export type AgentAction = FinalAction;

const ProposedConcernSchema = ConcernSchema.extend({ description: AgentStateDescription, whyItMatters: AgentStateDescription });
const ProposedRelationshipSchema = RelationshipSchema.extend({ description: AgentStateDescription });
export const ConcernChangeSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("upsert").describe("Concernを追加または更新する"), concern: ProposedConcernSchema.describe("追加または更新するConcernの完全な値") }),
  z.object({ operation: z.literal("remove").describe("Concernを削除する"), id: Id.describe("削除するConcernのID") })
]).describe("次のEventにも残すConcernの変更。変更不要なら出力しない");
export const RelationshipChangeSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("upsert").describe("Relationshipを追加または更新する"), relationship: ProposedRelationshipSchema.describe("追加または更新するRelationshipの完全な値") }),
  z.object({ operation: z.literal("remove").describe("Relationshipを削除する"), subjectId: Id.describe("削除するRelationshipの相手ID") })
]).describe("次のEventにも残すRelationshipの変更。変更不要なら出力しない");
export const AgentTurnSchema = z.object({
  desire: AgentDesire.describe("現在のSelf、状態、Observation、Memory、Event Assessmentから生じた今回の具体的な望み"),
  action: FinalActionSchema,
  patch: z.object({
    mood: AgentMood.describe("次のEventにも持続させる現在の気分。変化がない場合は省略する").optional(),
    relationship: RelationshipChangeSchema.optional().describe("Relationshipの変更を1件だけ提案する。抽象的過ぎる内容は避ける。変更不要なら省略する"),
    remember: z.string().trim().min(1).max(800).describe("今回直ちに記憶候補として残す内容。長期的価値がなければ省略する").optional()
  }).strict().describe("次のEventにも影響する永続状態の変更提案。変更がなければpatch全体を省略する").optional()
}).strict();
export type AgentTurn = z.infer<typeof AgentTurnSchema>;

export const AgentCoreInputSchema = z.object({
  run: z.object({
    runId: Id,
    eventId: Id,
    agentId: Id,
    occurredAt: Instant,
    transport: z.object({ hop: z.number().int().min(0).max(32), expiresAt: Instant, replyTo: Id.optional() }).optional()
  }),
  observation: ObservationSchema,
  recentExperiences: z.array(RecentExperienceSchema).max(8).default([]),
  persona: BotPersonaSchema.optional(),
  currentSelf: CurrentSelfSchema,
  state: CurrentAgentStateSchema,
  memories: z.array(MemorySchema),
  memoryRetrievalTrace: z.array(MemoryRetrievalTraceSchema).default([]),
  availableTools: z.array(z.object({ name: Id, description: NaturalLanguage, inputSchema: z.record(z.string(), z.unknown()) })),
  runtimeConstraints: z.array(NaturalLanguage),
  limits: RunLimitsSchema
}).strict().superRefine((value, context) => {
  const owners = [value.currentSelf.agentId, value.state.agentId, ...value.recentExperiences.map((item) => item.agentId), ...value.memories.map((item) => item.agentId)];
  if (owners.some((owner) => owner !== value.run.agentId)) context.addIssue({ code: "custom", message: "context contains data owned by another agent" });
});
export type AgentCoreInput = z.infer<typeof AgentCoreInputSchema>;

export const AgentCoreOutputSchema = AgentTurnSchema.describe("Event Assessmentを受けて決めたDesire、最終Action、次のEventへ残す任意の状態変化");
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
  concernProposals: z.array(ConcernProposalSchema).optional(),
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
