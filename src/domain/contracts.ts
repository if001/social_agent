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
  sharedDisposition: NaturalLanguage,
  capabilities: z.array(Id)
});

export const AgentSchema = z.object({
  id: Id,
  familyId: Id,
  identity: NaturalLanguage,
  initialDisposition: NaturalLanguage,
  acquiredDisposition: NaturalLanguage,
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

export const DynamicStateSchema = z.object({
  agentId: Id,
  mood: NaturalLanguage,
  drives: z.array(NaturalLanguage),
  currentInterests: z.array(NaturalLanguage),
  updatedAt: Instant
});
export type DynamicState = z.infer<typeof DynamicStateSchema>;

export const SocialContextSchema = z.object({
  id: Id,
  agentId: Id,
  subjectId: Id,
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
  exclusionReason: z.enum(["rank-limit", "category-diversity", "context-budget"]).optional()
});
export type MemoryRetrievalTrace = z.infer<typeof MemoryRetrievalTraceSchema>;

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
  target: z.enum(["selfNarrative", "selfContinuity", "acquiredDisposition", "role", "raisonDetre", "longTermPreference", "longTermInterest", "semanticMemory", "selfRelatedMemory"]),
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
  target: z.enum(["emotion", "mood", "drives", "desires", "currentInterests", "socialContext"]),
  operation: z.enum(["set", "append", "remove"]),
  value: z.unknown(),
  reason: NaturalLanguage,
  evidenceIds: z.array(Id)
});

export const MemoryProposalSchema = MemorySchema.omit({ id: true, agentId: true, createdAt: true, kind: true, sourceAgentId: true }).extend({ kind: z.literal("episodic"), webSnapshotIds: z.array(Id).optional() });

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
  recentObservations: z.array(ObservationSchema).default([]),
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
  const owners = [value.self.id, value.dynamicState.agentId, ...value.socialContext.map((item) => item.agentId), ...value.memories.map((item) => item.agentId), ...value.intentions.map((item) => item.agentId)];
  if (owners.some((owner) => owner !== value.run.agentId)) context.addIssue({ code: "custom", message: "context contains data owned by another agent" });
});
export type AgentCoreInput = z.infer<typeof AgentCoreInputSchema>;

export const AgentCoreOutputSchema = z.object({
  interpretation: z.object({ subjectiveMeaning: NaturalLanguage.optional() }),
  internalChanges: z.object({
    transientStateUpdates: z.array(StateUpdateProposalSchema),
    memoryProposals: z.array(MemoryProposalSchema),
    intentionProposals: z.array(IntentionProposalSchema),
    longTermCandidates: z.array(LongTermCandidateProposalSchema)
  }),
  action: FinalActionSchema
});
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

export const AgentRunResultSchema = z.object({ output: AgentCoreOutputSchema, toolExecutions: z.array(ToolExecutionRecordSchema) });
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
