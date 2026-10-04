import { z } from "zod";

import { CandidateSchema, DomainError, MemorySchema, ObservationSchema, ReviewDecisionSchema, type Candidate, type Memory, type Observation } from "../domain/contracts.js";

export const ReviewInputSchema = z.object({ candidates: z.array(CandidateSchema).min(1), evidenceMemories: z.array(MemorySchema), evidenceEvents: z.array(ObservationSchema), currentValue: z.string().min(1) }).superRefine((value, context) => {
  if (value.evidenceMemories.length === 0 && value.evidenceEvents.length === 0) context.addIssue({ code: "custom", path: ["evidenceMemories"], message: "Review requires Memory or Event evidence" });
});
const CandidateDecisionSchema = z.object({ candidateId: z.string().min(1), decision: ReviewDecisionSchema, reason: z.string().min(1) });
export const ReviewOutputSchema = z.object({
  decisions: z.array(CandidateDecisionSchema).min(1),
  stateUpdate: z.object({ value: z.string().min(1), reason: z.string().min(1), evidenceMemoryIds: z.array(z.string().min(1)).default([]), evidenceEventIds: z.array(z.string().min(1)).default([]) }).superRefine((value, context) => {
    if (value.evidenceMemoryIds.length === 0 && value.evidenceEventIds.length === 0) context.addIssue({ code: "custom", path: ["evidenceMemoryIds"], message: "State update requires Memory or Event evidence" });
  }).optional()
}).superRefine((value, context) => {
  const requiresUpdate = value.decisions.some(({ decision }) => decision === "UPDATE" || decision === "MERGE");
  if (requiresUpdate && value.stateUpdate === undefined) context.addIssue({ code: "custom", path: ["stateUpdate"], message: "UPDATE and MERGE decisions require one consolidated stateUpdate" });
  if (!requiresUpdate && value.stateUpdate !== undefined) context.addIssue({ code: "custom", path: ["stateUpdate"], message: "stateUpdate requires an UPDATE or MERGE decision" });
});
export type ReviewInput = z.infer<typeof ReviewInputSchema>;
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;
export interface ReviewHarness { review(input: ReviewInput, signal: AbortSignal): Promise<ReviewOutput>; }
export type ReviewEvidence = { readonly memories: readonly Memory[]; readonly events: readonly Observation[] };
export type ReviewCommit = { readonly candidateDecisions: readonly { readonly candidateId: string; readonly status: Candidate["status"] }[]; readonly agentId: string; readonly target: Candidate["target"]; readonly before: string; readonly after?: string; readonly reason: string; readonly evidenceMemoryIds: readonly string[]; readonly evidenceEventIds: readonly string[] };
export interface LongTermReviewRepository { loadCandidates(candidateIds: readonly string[]): Promise<readonly Candidate[]>; loadEvidence(candidateIds: readonly string[], agentId: string): Promise<ReviewEvidence>; loadCurrentValue(agentId: string, target: Candidate["target"]): Promise<string>; commit(review: ReviewCommit): Promise<void>; }

export class LongTermReviewService {
  constructor(private readonly repository: LongTermReviewRepository, private readonly harness: ReviewHarness) {}
  async review(candidateIdOrIds: string | readonly string[], signal: AbortSignal): Promise<ReviewOutput> {
    const candidateIds = typeof candidateIdOrIds === "string" ? [candidateIdOrIds] : [...candidateIdOrIds];
    if (candidateIds.length === 0 || new Set(candidateIds).size !== candidateIds.length) throw new DomainError("VALIDATION", "Review requires unique Candidate IDs");
    const candidates = await this.repository.loadCandidates(candidateIds);
    if (candidates.length !== candidateIds.length) throw new DomainError("NOT_FOUND", "Candidate not found");
    const [first] = candidates; if (first === undefined) throw new DomainError("NOT_FOUND", "Candidate not found");
    if (candidates.some(({ agentId, target, status }) => agentId !== first.agentId || target !== first.target || status !== "pending")) throw new DomainError("VALIDATION", "Review Candidates must be pending and share one Agent and target");
    const evidence = await this.repository.loadEvidence(candidateIds, first.agentId);
    const evidenceById = new Map(evidence.memories.map((memory) => [memory.id, memory]));
    const eventById = new Map(evidence.events.map((event) => [event.eventId, event]));
    const requiredMemoryEvidence = new Set(candidates.flatMap(({ evidenceMemoryIds }) => evidenceMemoryIds));
    const requiredEventEvidence = new Set(candidates.flatMap(({ evidenceEventIds }) => evidenceEventIds));
    if ([...requiredMemoryEvidence].some((id) => !evidenceById.has(id)) || evidence.memories.some((memory) => memory.agentId !== first.agentId) || [...requiredEventEvidence].some((id) => !eventById.has(id))) throw new DomainError("VALIDATION", "Candidate evidence is missing or belongs to another agent");
    const currentValue = await this.repository.loadCurrentValue(first.agentId, first.target);
    const output = ReviewOutputSchema.parse(await this.harness.review({ candidates: [...candidates], evidenceMemories: [...evidence.memories], evidenceEvents: [...evidence.events], currentValue }, signal));
    const decisionIds = output.decisions.map(({ candidateId }) => candidateId);
    if (new Set(decisionIds).size !== candidateIds.length || candidateIds.some((id) => !decisionIds.includes(id))) throw new DomainError("VALIDATION", "Review output must decide every Candidate exactly once");
    if (output.stateUpdate?.evidenceMemoryIds.some((id) => !requiredMemoryEvidence.has(id)) === true || output.stateUpdate?.evidenceEventIds.some((id) => !requiredEventEvidence.has(id)) === true) throw new DomainError("VALIDATION", "Review update references evidence outside the reviewed Candidates");
    const statuses = ({ KEEP: "pending", UPDATE: "applied", MERGE: "merged", DROP: "dropped" } as const);
    await this.repository.commit({ candidateDecisions: output.decisions.map(({ candidateId, decision }) => ({ candidateId, status: statuses[decision] })), agentId: first.agentId, target: first.target, before: currentValue, ...(output.stateUpdate === undefined ? {} : { after: output.stateUpdate.value }), reason: output.stateUpdate?.reason ?? output.decisions.map(({ reason }) => reason).join("; "), evidenceMemoryIds: output.stateUpdate?.evidenceMemoryIds ?? [...requiredMemoryEvidence], evidenceEventIds: output.stateUpdate?.evidenceEventIds ?? [...requiredEventEvidence] });
    return output;
  }
}

export function compactNaturalLanguage(values: readonly string[], maxItems: number): readonly string[] {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (unique.length <= maxItems) return unique;
  return [...unique.slice(0, Math.max(0, maxItems - 1)), unique.slice(Math.max(0, maxItems - 1)).join("; ")];
}
