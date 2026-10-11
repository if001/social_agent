import { z } from "zod";

const Id = z.string().min(1);
const Instant = z.iso.datetime({ offset: true });
const NaturalLanguage = z.string().trim().min(1).max(16_000);

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

export const AgentSchema = z.object({
  id: Id,
  familyId: Id,
  identity: NaturalLanguage,
  disposition: z.object({
    shared: NaturalLanguage,
    initial: NaturalLanguage,
    acquired: NaturalLanguage
  }),
  values: NaturalLanguage,
  interests: z.array(NaturalLanguage),
  preferences: z.array(NaturalLanguage),
  roles: z.array(NaturalLanguage),
  raisonDetre: NaturalLanguage.optional(),
  selfNarrative: NaturalLanguage,
  selfContinuity: NaturalLanguage,
  version: z.number().int().nonnegative()
});
export type Agent = z.infer<typeof AgentSchema>;

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

export const MotiveProgressSchema = z.union([z.literal(0), z.literal(25), z.literal(50), z.literal(75), z.literal(100)]);
export const MotiveSchema = z.object({ id: Id, description: NaturalLanguage, goal: NaturalLanguage.optional(), progress: MotiveProgressSchema.optional(), sourceEvidenceIds: z.array(Id), since: Instant, nextConsiderAt: Instant.optional(), considerationReason: NaturalLanguage.optional() }).superRefine((value, context) => {
  if ((value.goal === undefined) !== (value.progress === undefined)) context.addIssue({ code: "custom", path: [value.goal === undefined ? "goal" : "progress"], message: "goal and progress must be provided together" });
  if ((value.nextConsiderAt === undefined) !== (value.considerationReason === undefined)) context.addIssue({ code: "custom", path: [value.nextConsiderAt === undefined ? "nextConsiderAt" : "considerationReason"], message: "nextConsiderAt and considerationReason must be provided together" });
});
export type Motive = z.infer<typeof MotiveSchema>;
export const MotiveExplorationSchema = z.object({ motiveId: Id, consecutiveNoProgress: z.number().int().nonnegative(), lastExploredAt: Instant.optional(), cooldownUntil: Instant.optional() });
export type MotiveExploration = z.infer<typeof MotiveExplorationSchema>;
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
    values: NaturalLanguage,
    interests: z.array(NaturalLanguage).default([]),
    preferences: z.array(NaturalLanguage).default([]),
    roles: z.array(NaturalLanguage).default([]),
    raisonDetre: NaturalLanguage.optional(),
    selfNarrative: NaturalLanguage,
    selfContinuity: NaturalLanguage
  }),
  initialState: z.object({
    mood: NaturalLanguage.default("特定の持続的な気分はまだ形成されていない"),
    motives: z.array(MotiveSchema).default([])
  }).default({ mood: "特定の持続的な気分はまだ形成されていない", motives: [] })
});
export type InitialSelfConfig = z.infer<typeof InitialSelfConfigSchema>;
export const DynamicStateSchema = z.object({
  agentId: Id,
  mood: NaturalLanguage,
  emotion: z.object({ description: NaturalLanguage, occurredAt: Instant, evidenceEventId: Id }).optional(),
  motives: z.array(MotiveSchema),
  motiveExploration: z.array(MotiveExplorationSchema).default([]),
  updatedAt: Instant
});
export type DynamicState = z.infer<typeof DynamicStateSchema>;

export const SocialContextSchema = z.object({
  id: Id,
  agentId: Id,
  subjectId: Id,
  subjectType: z.enum(["user", "agent", "team", "project", "organization"]),
  description: NaturalLanguage,
  updatedAt: Instant
});
export type SocialContext = z.infer<typeof SocialContextSchema>;

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
export const RecentExperienceSchema = z.object({
  eventId: Id,
  runId: Id.optional(),
  agentId: Id,
  occurredAt: Instant,
  eventKind: EventKindSchema,
  observation: ObservationSchema,
  steps: z.array(RecentExperienceStepSchema),
  progressChanged: z.boolean()
});
export type RecentExperience = z.infer<typeof RecentExperienceSchema>;

export const ReviewDecisionSchema = z.enum(["KEEP", "UPDATE", "MERGE", "DROP"]);
export const CandidateSchema = z.object({
  id: Id,
  agentId: Id,
  target: z.enum(["selfNarrative", "selfContinuity", "values", "acquiredDisposition", "role", "raisonDetre", "longTermPreference", "longTermInterest", "semanticMemory", "selfRelatedMemory"]),
  proposal: NaturalLanguage,
  reason: NaturalLanguage,
  evidenceMemoryIds: z.array(Id),
  evidenceEventIds: z.array(Id).default([]),
  status: z.enum(["pending", "kept", "applied", "merged", "dropped"]),
  createdAt: Instant
}).superRefine((value, context) => {
  if (value.evidenceMemoryIds.length === 0 && value.evidenceEventIds.length === 0) context.addIssue({ code: "custom", path: ["evidenceMemoryIds"], message: "candidate requires Memory or Event evidence" });
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const FinalActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("respond"), content: NaturalLanguage.describe("相手へ配送する最終応答の本文。personaの発話表現を適用する") }),
  z.object({
    type: z.literal("refuse"),
    content: NaturalLanguage.describe("相手へ配送する拒否の本文。personaの発話表現を適用し、内部の判断根拠は含めない"),
    reason: NaturalLanguage.describe("依頼を断る内部の判断根拠。外部へそのまま配送しない"),
    basis: z.enum(["personality", "system"]).describe("拒否の根拠。personalityは自身の価値観、systemは実行制約")
  }),
  z.object({ type: z.literal("no-external-action"), reason: NaturalLanguage.describe("Toolで具体的行動を実行した結果、外部への応答配送が不要な理由。未実行の保留には使わない") })
]).describe("今回の動機に基づく最終行動。Tool実行自体はAgent内部で完了させる");
export type FinalAction = z.infer<typeof FinalActionSchema>;
export const AgentActionSchema = FinalActionSchema;
export type AgentAction = FinalAction;

export const StateUpdateProposalSchema = z.object({
  target: z.enum(["emotion", "mood", "socialContext"]),
  operation: z.enum(["set", "append", "remove"]),
  value: z.unknown(),
  reason: NaturalLanguage,
  evidenceIds: z.array(Id)
});

export const MemoryProposalSchema = MemorySchema.omit({ id: true, agentId: true, occurredAt: true, createdAt: true, kind: true, sourceAgentId: true, evidenceEventIds: true }).extend({ webSnapshotIds: z.array(Id).default([]) });

export const LongTermCandidateProposalSchema = z.object({
  target: CandidateSchema.shape.target,
  proposal: NaturalLanguage,
  reason: NaturalLanguage,
  evidenceMemoryIds: z.array(Id),
  evidenceEventIds: z.array(Id).default([])
}).superRefine((value, context) => {
  if (value.evidenceMemoryIds.length === 0 && value.evidenceEventIds.length === 0) context.addIssue({ code: "custom", path: ["evidenceMemoryIds"], message: "candidate requires Memory or Event evidence" });
});

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
  self: AgentSchema,
  dynamicState: DynamicStateSchema,
  socialContext: z.array(SocialContextSchema),
  memories: z.array(MemorySchema),
  memoryRetrievalTrace: z.array(MemoryRetrievalTraceSchema).default([]),
  availableTools: z.array(z.object({ name: Id, description: NaturalLanguage, inputSchema: z.record(z.string(), z.unknown()) })),
  runtimeConstraints: z.array(NaturalLanguage),
  limits: RunLimitsSchema
}).superRefine((value, context) => {
  const owners = [value.self.id, value.dynamicState.agentId, ...value.recentExperiences.map((item) => item.agentId), ...value.socialContext.map((item) => item.agentId), ...value.memories.map((item) => item.agentId)];
  if (owners.some((owner) => owner !== value.run.agentId)) context.addIssue({ code: "custom", message: "context contains data owned by another agent" });
});
export type AgentCoreInput = z.infer<typeof AgentCoreInputSchema>;

export const ActiveMotiveEvidenceRefSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("event"), id: Id }),
  z.object({ kind: z.literal("memory"), id: Id }),
  z.object({ kind: z.literal("self"), agentId: Id, version: z.number().int().nonnegative() }),
  z.object({ kind: z.literal("mood"), agentId: Id, updatedAt: Instant }),
  z.object({ kind: z.literal("social-context"), id: Id, agentId: Id, updatedAt: Instant }),
  z.object({ kind: z.literal("motive"), id: Id, agentId: Id, since: Instant }),
  z.object({ kind: z.literal("emotion"), agentId: Id, evidenceEventId: Id, occurredAt: Instant })
]);

export const AgentCoreOutputSchema = z.object({
  interpretation: z.object({
    subjectiveMeaning: NaturalLanguage.optional().describe("今回のEventが自分に持つ主観的な意味。不要な場合は省略する"),
    activeMotive: z.object({
      description: NaturalLanguage.describe("今回の行動を生じさせる動機。保存済みMotiveが適切でなければObservation、Self、Mood、Memory、Social Contextから今回限りの動機を形成する"),
      motiveId: Id.optional().describe("選んだ保存済みMotiveのID。今回形成した動機では省略し、IDを生成しない"),
      evidenceIds: z.array(Id).min(1).describe("動機の根拠となる入力中のEvent、MemoryのID。少なくとも1件指定する"),
      evidenceRefs: z.array(ActiveMotiveEvidenceRefSchema).optional().describe("Self、Mood、Social Context、保存Motive、current Emotionを根拠にする場合の型付きsnapshot参照")
    }).describe("今回のActionを生じさせる動機を必ず1件活性化する")
  }).describe("入力Eventの意味づけと今回の動機"),
  internalChanges: z.object({
    immediateStateUpdates: z.array(StateUpdateProposalSchema.extend({
      target: z.literal("emotion").describe("即時更新の対象はEmotionだけ"),
      operation: z.literal("set").describe("現在のEmotionを置き換える"),
      value: NaturalLanguage.describe("今回のEventへの感情を表す自然言語の文章"),
      reason: NaturalLanguage.describe("この感情になった理由"),
      evidenceIds: z.array(Id).describe("感情の根拠となる入力中のEvent、MemoryなどのID")
    })).describe("今回のEmotion更新案。変更が不要なら空配列。持続状態の更新はPost-processに任せる")
  }).describe("保存前の即時状態の更新提案"),
  action: FinalActionSchema
}).describe("Interactionの最終結果。Eventの解釈、即時状態の更新案、最終行動を返す");
export type AgentCoreOutput = z.infer<typeof AgentCoreOutputSchema>;

const MotiveProposalBase = { reason: NaturalLanguage, evidenceIds: z.array(Id).min(1) };
const MotiveShape = { description: NaturalLanguage, goal: NaturalLanguage.optional(), progress: MotiveProgressSchema.optional(), nextConsiderAt: Instant.optional(), considerationReason: NaturalLanguage.optional() };
export const MotiveProposalSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), ...MotiveShape, ...MotiveProposalBase }).strict(),
  z.object({ operation: z.literal("maintain"), motiveId: Id, ...MotiveProposalBase }).strict(),
  z.object({ operation: z.literal("update"), motiveId: Id, ...MotiveShape, ...MotiveProposalBase }).strict(),
  z.object({ operation: z.literal("merge"), motiveIds: z.array(Id).min(2), ...MotiveShape, ...MotiveProposalBase }).strict(),
  z.object({ operation: z.enum(["resolve", "drop"]), motiveId: Id, ...MotiveProposalBase }).strict()
]).superRefine((value, context) => {
  if ("goal" in value && ((value.goal === undefined) !== (value.progress === undefined))) context.addIssue({ code: "custom", path: [value.goal === undefined ? "goal" : "progress"], message: "goal and progress must be provided together" });
  if ("nextConsiderAt" in value && ((value.nextConsiderAt === undefined) !== (value.considerationReason === undefined))) context.addIssue({ code: "custom", path: [value.nextConsiderAt === undefined ? "nextConsiderAt" : "considerationReason"], message: "nextConsiderAt and considerationReason must be provided together" });
});
export type MotiveProposal = z.infer<typeof MotiveProposalSchema>;

export const ContinuityOutputSchema = z.object({
  persistentStateUpdates: z.array(StateUpdateProposalSchema).superRefine((updates, context) => {
    updates.forEach((update, index) => {
      if (!["mood", "socialContext"].includes(update.target)) context.addIssue({ code: "custom", path: [index, "target"], message: "Continuity may update only Mood and Social Context here" });
    });
  }),
  motiveProposals: z.array(MotiveProposalSchema)
});
export type ContinuityOutput = z.infer<typeof ContinuityOutputSchema>;
export const MemoryExtractionOutputSchema = z.object({ memoryProposals: z.array(MemoryProposalSchema) });
export type MemoryExtractionOutput = z.infer<typeof MemoryExtractionOutputSchema>;
export const CandidateDetectionOutputSchema = z.object({ longTermCandidates: z.array(LongTermCandidateProposalSchema) });
export type CandidateDetectionOutput = z.infer<typeof CandidateDetectionOutputSchema>;

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
  output: AgentCoreOutputSchema,
  toolExecutions: z.array(ToolExecutionRecordSchema),
  budget: z.object({
    limits: RunLimitsSchema.pick({ deadlineMs: true, maxSteps: true, maxToolCalls: true }),
    consumed: z.object({ modelCalls: z.number().int().nonnegative(), toolCalls: z.number().int().nonnegative(), repairs: z.number().int().nonnegative() })
  }).optional()
});
export type AgentRunResult = z.infer<typeof AgentRunResultSchema>;

const PostProcessToolResultSchema = z.object({ name: Id, ok: z.boolean(), summary: NaturalLanguage, webSnapshotIds: z.array(Id) });
export const PostProcessSnapshotSchema = z.object({
  run: AgentCoreInputSchema.shape.run.pick({ runId: true, eventId: true, agentId: true, occurredAt: true }),
  observation: ObservationSchema,
  recentExperiences: z.array(RecentExperienceSchema),
  persona: BotPersonaSchema.optional(),
  self: AgentSchema,
  dynamicState: DynamicStateSchema,
  socialContext: z.array(SocialContextSchema),
  memories: z.array(MemorySchema),
  interaction: z.object({ interpretation: AgentCoreOutputSchema.shape.interpretation, action: FinalActionSchema, toolResults: z.array(PostProcessToolResultSchema) })
});
export type PostProcessSnapshot = z.infer<typeof PostProcessSnapshotSchema>;
export const ContinuityInputSchema = PostProcessSnapshotSchema;
export type ContinuityInput = z.infer<typeof ContinuityInputSchema>;
export const MemoryExtractionInputSchema = PostProcessSnapshotSchema;
export type MemoryExtractionInput = z.infer<typeof MemoryExtractionInputSchema>;
export const CandidateDetectionInputSchema = z.object({
  run: PostProcessSnapshotSchema.shape.run,
  self: AgentSchema,
  memories: z.array(MemorySchema).min(1)
});
export type CandidateDetectionInput = z.infer<typeof CandidateDetectionInputSchema>;

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
