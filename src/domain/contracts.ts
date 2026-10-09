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

export const DriveSchema = z.object({ description: NaturalLanguage, sourceEvidenceIds: z.array(Id), since: Instant });
export type Drive = z.infer<typeof DriveSchema>;
export const InterestProgressSchema = z.union([z.literal(0), z.literal(25), z.literal(50), z.literal(75), z.literal(100)]);
export const CurrentInterestSchema = z.object({ id: Id, focus: NaturalLanguage, goal: NaturalLanguage, progress: InterestProgressSchema });
export type CurrentInterest = z.infer<typeof CurrentInterestSchema>;
export const InterestExplorationSchema = z.object({ interestId: Id, consecutiveNoProgress: z.number().int().nonnegative(), lastExploredAt: Instant.optional(), cooldownUntil: Instant.optional() });
export type InterestExploration = z.infer<typeof InterestExplorationSchema>;
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
    drives: z.array(DriveSchema).default([]),
    currentInterests: z.array(CurrentInterestSchema).default([])
  }).default({ mood: "特定の持続的な気分はまだ形成されていない", drives: [], currentInterests: [] })
});
export type InitialSelfConfig = z.infer<typeof InitialSelfConfigSchema>;
export const DynamicStateSchema = z.object({
  agentId: Id,
  mood: NaturalLanguage,
  drives: z.array(DriveSchema),
  currentInterests: z.array(CurrentInterestSchema),
  interestExploration: z.array(InterestExplorationSchema).default([]),
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
  relatedIntentionIds: z.array(Id),
  importance: NaturalLanguage,
  retrievalPriority: z.enum(["low", "normal", "high", "critical"]).default("normal"),
  sourceAgentId: Id.optional(),
  evidenceEventIds: z.array(Id)
});
export type Memory = z.infer<typeof MemorySchema>;

export const MemoryRetrievalTraceSchema = z.object({
  memoryId: Id,
  finalRank: z.number().int().positive(),
  matchedBy: z.array(z.enum(["vector", "keyword", "subject", "intention", "recency"])),
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

export const IntentionStatusSchema = z.enum(["active", "completed", "dropped", "superseded"]);
export const IntentionTriggerSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("time"), at: Instant }),
  z.object({ kind: z.literal("event"), eventKinds: z.array(EventKindSchema).min(1), keywords: z.array(NaturalLanguage).default([]) }),
  z.object({ kind: z.literal("idle"), idleForMs: z.number().int().positive() }),
  z.object({ kind: z.literal("manual-review") })
]);
export type IntentionTrigger = z.infer<typeof IntentionTriggerSchema>;
export const IntentionSchema = z.object({
  id: Id,
  agentId: Id,
  description: NaturalLanguage,
  status: IntentionStatusSchema,
  reason: NaturalLanguage,
  trigger: IntentionTriggerSchema.optional(),
  createdAt: Instant,
  updatedAt: Instant,
  nextReviewAt: Instant.optional(),
  supersededById: Id.optional()
}).superRefine((value, context) => {
  if (value.status === "superseded" && value.supersededById === undefined) {
    context.addIssue({ code: "custom", message: "superseded intentions require supersededById", path: ["supersededById"] });
  }
});
export type Intention = z.infer<typeof IntentionSchema>;

const intentionTransitions: Readonly<Record<Intention["status"], readonly Intention["status"][]>> = {
  active: ["completed", "dropped", "superseded"],
  completed: [],
  dropped: [],
  superseded: []
};
export function canTransitionIntention(from: Intention["status"], to: Intention["status"]): boolean {
  return intentionTransitions[from].includes(to);
}

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
  z.object({ type: z.literal("respond"), content: NaturalLanguage }),
  z.object({ type: z.literal("wait"), until: Instant.optional(), reason: NaturalLanguage }),
  z.object({ type: z.literal("refuse"), reason: NaturalLanguage, basis: z.enum(["personality", "system"]) }),
  z.object({ type: z.literal("no-action"), reason: NaturalLanguage })
]);
export type FinalAction = z.infer<typeof FinalActionSchema>;
export const AgentActionSchema = FinalActionSchema;
export type AgentAction = FinalAction;

export const StateUpdateProposalSchema = z.object({
  target: z.enum(["emotion", "mood", "drives", "desires", "socialContext"]),
  operation: z.enum(["set", "append", "remove"]),
  value: z.unknown(),
  reason: NaturalLanguage,
  evidenceIds: z.array(Id)
});

export const MemoryProposalSchema = MemorySchema.omit({ id: true, agentId: true, occurredAt: true, createdAt: true, kind: true, sourceAgentId: true, evidenceEventIds: true }).extend({ webSnapshotIds: z.array(Id).default([]) });

const CreateIntentionProposalSchema = z.object({
  operation: z.literal("create"),
  description: NaturalLanguage,
  reason: NaturalLanguage,
  trigger: IntentionTriggerSchema.optional(),
  nextReviewAt: Instant.optional()
});
const UpdateIntentionProposalSchema = z.object({
  operation: z.literal("update"),
  intentionId: Id,
  description: NaturalLanguage.optional(),
  status: IntentionStatusSchema.optional(),
  reason: NaturalLanguage,
  nextReviewAt: Instant.nullable().optional(),
  supersededByIntentionId: Id.optional()
}).superRefine((value, context) => {
  if (value.status === "superseded" && value.supersededByIntentionId === undefined) context.addIssue({ code: "custom", path: ["supersededByIntentionId"], message: "superseded updates require supersededByIntentionId" });
  if (value.status !== "superseded" && value.supersededByIntentionId !== undefined) context.addIssue({ code: "custom", path: ["supersededByIntentionId"], message: "supersededByIntentionId is only valid for superseded updates" });
});
export const IntentionProposalSchema = z.discriminatedUnion("operation", [CreateIntentionProposalSchema, UpdateIntentionProposalSchema]);

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
  intentions: z.array(IntentionSchema),
  availableTools: z.array(z.object({ name: Id, description: NaturalLanguage, inputSchema: z.record(z.string(), z.unknown()) })),
  runtimeConstraints: z.array(NaturalLanguage),
  limits: RunLimitsSchema
}).superRefine((value, context) => {
  const owners = [value.self.id, value.dynamicState.agentId, ...value.recentExperiences.map((item) => item.agentId), ...value.socialContext.map((item) => item.agentId), ...value.memories.map((item) => item.agentId), ...value.intentions.map((item) => item.agentId)];
  if (owners.some((owner) => owner !== value.run.agentId)) context.addIssue({ code: "custom", message: "context contains data owned by another agent" });
});
export type AgentCoreInput = z.infer<typeof AgentCoreInputSchema>;

export const AgentCoreOutputSchema = z.object({
  interpretation: z.object({ subjectiveMeaning: NaturalLanguage.optional() }),
  internalChanges: z.object({
    immediateStateUpdates: z.array(StateUpdateProposalSchema).superRefine((updates, context) => {
      updates.forEach((update, index) => {
        if (update.target !== "emotion" && update.target !== "desires") context.addIssue({ code: "custom", path: [index, "target"], message: "Interaction may update only Emotion and Desire" });
      });
    })
  }),
  action: FinalActionSchema
});
export type AgentCoreOutput = z.infer<typeof AgentCoreOutputSchema>;

const DriveProposalBase = { reason: NaturalLanguage, evidenceIds: z.array(Id).min(1) };
export const DriveProposalSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), description: NaturalLanguage, ...DriveProposalBase }).strict(),
  z.object({ operation: z.literal("maintain"), driveDescription: NaturalLanguage, ...DriveProposalBase }).strict(),
  z.object({ operation: z.literal("update"), driveDescription: NaturalLanguage, description: NaturalLanguage, ...DriveProposalBase }).strict(),
  z.object({ operation: z.literal("merge"), driveDescriptions: z.array(NaturalLanguage).min(2), description: NaturalLanguage, ...DriveProposalBase }).strict(),
  z.object({ operation: z.literal("end"), driveDescription: NaturalLanguage, ...DriveProposalBase }).strict()
]);
export type DriveProposal = z.infer<typeof DriveProposalSchema>;

const InterestProposalBase = { reason: NaturalLanguage, evidenceIds: z.array(Id).min(1) };
export const CurrentInterestProposalSchema = z.discriminatedUnion("operation", [
  z.object({ operation: z.literal("create"), focus: NaturalLanguage, goal: NaturalLanguage, progress: InterestProgressSchema.default(0), ...InterestProposalBase }).strict(),
  z.object({ operation: z.literal("progress"), interestId: Id, progress: InterestProgressSchema, ...InterestProposalBase }).strict(),
  z.object({ operation: z.literal("reframe"), interestId: Id, focus: NaturalLanguage, goal: NaturalLanguage, progress: InterestProgressSchema, ...InterestProposalBase }).strict(),
  z.object({ operation: z.literal("resolve"), interestId: Id, ...InterestProposalBase }).strict(),
  z.object({ operation: z.literal("drop"), interestId: Id, ...InterestProposalBase }).strict()
]);
export type CurrentInterestProposal = z.infer<typeof CurrentInterestProposalSchema>;

export const ContinuityOutputSchema = z.object({
  persistentStateUpdates: z.array(StateUpdateProposalSchema).superRefine((updates, context) => {
    updates.forEach((update, index) => {
      if (!["mood", "socialContext"].includes(update.target)) context.addIssue({ code: "custom", path: [index, "target"], message: "Continuity may update only Mood and Social Context here" });
    });
  }),
  driveProposals: z.array(DriveProposalSchema),
  currentInterestProposals: z.array(CurrentInterestProposalSchema),
  intentionProposals: z.array(IntentionProposalSchema)
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

export const AgentRunResultSchema = z.object({ output: AgentCoreOutputSchema, toolExecutions: z.array(ToolExecutionRecordSchema) });
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
  intentions: z.array(IntentionSchema),
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

export type DomainErrorCode = "VALIDATION" | "CONFLICT" | "NOT_FOUND" | "TIMEOUT" | "ABORTED" | "EXTERNAL";
export class DomainError extends Error {
  constructor(readonly code: DomainErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "DomainError";
  }
}
