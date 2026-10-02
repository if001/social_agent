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
  role: NaturalLanguage,
  selfNarrative: NaturalLanguage,
  selfContinuity: NaturalLanguage,
  version: z.number().int().nonnegative()
});
export type Agent = z.infer<typeof AgentSchema>;

export const DynamicStateSchema = z.object({
  agentId: Id,
  emotion: NaturalLanguage,
  mood: NaturalLanguage,
  drive: NaturalLanguage,
  desire: NaturalLanguage,
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
  observedAt: Instant
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
  sourceAgentId: Id.optional(),
  evidenceEventIds: z.array(Id)
});
export type Memory = z.infer<typeof MemorySchema>;

export const IntentionStatusSchema = z.enum(["active", "completed", "dropped", "superseded"]);
export const IntentionSchema = z.object({
  id: Id,
  agentId: Id,
  description: NaturalLanguage,
  status: IntentionStatusSchema,
  reason: NaturalLanguage,
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
  target: z.enum(["selfNarrative", "acquiredDisposition"]),
  proposal: NaturalLanguage,
  reason: NaturalLanguage,
  evidenceMemoryIds: z.array(Id).min(1),
  status: z.enum(["pending", "kept", "applied", "merged", "dropped"]),
  createdAt: Instant
});
export type Candidate = z.infer<typeof CandidateSchema>;

export const ToolCallSchema = z.object({ id: Id, name: Id, input: z.record(z.string(), z.unknown()) });
export const AgentActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("respond"), content: NaturalLanguage }),
  z.object({ type: z.literal("tool"), call: ToolCallSchema }),
  z.object({ type: z.literal("wait"), until: Instant.optional(), reason: NaturalLanguage }),
  z.object({ type: z.literal("refuse"), reason: NaturalLanguage, basis: z.enum(["personality", "system"]) }),
  z.object({ type: z.literal("no-action"), reason: NaturalLanguage })
]);
export type AgentAction = z.infer<typeof AgentActionSchema>;

export const StateUpdateProposalSchema = z.object({
  target: z.enum(["emotion", "mood", "drive", "desire", "socialContext"]),
  operation: z.enum(["set", "append", "remove"]),
  value: z.unknown(),
  reason: NaturalLanguage,
  evidenceIds: z.array(Id)
});

export const AgentCoreInputSchema = z.object({
  run: z.object({ runId: Id, eventId: Id, agentId: Id, occurredAt: Instant }),
  observation: ObservationSchema,
  self: AgentSchema,
  dynamicState: DynamicStateSchema,
  socialContext: z.array(SocialContextSchema),
  memories: z.array(MemorySchema),
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
  subjectiveMeaning: NaturalLanguage.optional(),
  stateUpdates: z.array(StateUpdateProposalSchema),
  memoryUpdates: z.array(MemorySchema.omit({ id: true, createdAt: true })),
  intentionUpdates: z.array(IntentionSchema),
  longTermCandidates: z.array(CandidateSchema),
  action: AgentActionSchema
});
export type AgentCoreOutput = z.infer<typeof AgentCoreOutputSchema>;

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
