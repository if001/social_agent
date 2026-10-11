import { z } from "zod";

const Id = z.string().min(1);
const Instant = z.iso.datetime({ offset: true });
const NaturalLanguage = z.string().trim().min(1).max(16_000);

export const SelfSchema = z.object({
  identity: NaturalLanguage,
  disposition: NaturalLanguage,
  selfStory: NaturalLanguage,
  commitments: z.array(NaturalLanguage)
});
export type Self = z.infer<typeof SelfSchema>;

export const ConcernSchema = z.object({
  id: Id,
  description: NaturalLanguage,
  whyItMatters: NaturalLanguage,
  status: z.enum(["active", "satisfied", "abandoned"]),
  reconsiderAt: Instant.optional()
});
export type Concern = z.infer<typeof ConcernSchema>;

export const RelationshipSchema = z.object({ subjectId: Id, description: NaturalLanguage });
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


export const FinalActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("respond"), content: NaturalLanguage.describe("相手へ配送する最終応答の本文。personaの発話表現を適用する") }),
  z.object({
    type: z.literal("refuse"),
    content: NaturalLanguage.describe("相手へ配送する拒否の本文。personaの発話表現を適用し、内部の判断根拠は含めない"),
    reason: NaturalLanguage.describe("依頼を断る内部の判断根拠。外部へそのまま配送しない"),
    basis: z.enum(["personality", "system"]).describe("拒否の根拠。personalityは自身の価値観、systemは実行制約")
  }),
  z.object({
    type: z.literal("notify-no-execution"),
    content: NaturalLanguage.describe("具体的な実行対象を選ばなかった判断と理由をownerへ通知する本文"),
    reason: NaturalLanguage.describe("実行しないと判断した内部理由")
  }),
  z.object({ type: z.literal("no-external-action"), reason: NaturalLanguage.describe("Toolで具体的行動を実行した結果、外部への応答配送が不要な理由。未実行の保留には使わない") })
]).describe("今回の動機に基づく最終行動。Tool実行自体はAgent内部で完了させる");
export type FinalAction = z.infer<typeof FinalActionSchema>;
export const AgentActionSchema = FinalActionSchema;
export type AgentAction = FinalAction;

export const ConcernChangeSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("upsert"), concern: ConcernSchema }),
  z.object({ operation: z.literal("remove"), id: Id })
]);
export const RelationshipChangeSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("upsert"), relationship: RelationshipSchema }),
  z.object({ operation: z.literal("remove"), subjectId: Id })
]);
export const AgentTurnSchema = z.object({
  desire: NaturalLanguage,
  action: FinalActionSchema,
  patch: z.object({
    mood: NaturalLanguage.optional(),
    concern: ConcernChangeSchema.optional(),
    relationship: RelationshipChangeSchema.optional(),
    remember: NaturalLanguage.optional()
  }).strict().optional()
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
