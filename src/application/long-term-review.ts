import { z } from "zod";

import { CandidateSchema, DomainError, MemorySchema, ReviewDecisionSchema, type Candidate, type Memory } from "../domain/contracts.js";

export const ReviewInputSchema = z.object({ candidate: CandidateSchema, evidence: z.array(MemorySchema).min(1), currentValue: z.string().min(1) });
export const ReviewOutputSchema = z.object({ decision: ReviewDecisionSchema, value: z.string().min(1).optional(), reason: z.string().min(1) }).superRefine((value, context) => {
  if (["UPDATE", "MERGE"].includes(value.decision) && value.value === undefined) context.addIssue({ code: "custom", path: ["value"], message: "UPDATE and MERGE require a value" });
});
export type ReviewInput = z.infer<typeof ReviewInputSchema>;
export type ReviewOutput = z.infer<typeof ReviewOutputSchema>;
export interface ReviewHarness { review(input: ReviewInput, signal: AbortSignal): Promise<ReviewOutput>; }
export type ReviewCommit = { readonly candidateId: string; readonly agentId: string; readonly target: Candidate["target"]; readonly status: Candidate["status"]; readonly before: string; readonly after?: string; readonly reason: string; readonly evidenceMemoryIds: readonly string[] };
export interface LongTermReviewRepository { loadCandidate(candidateId: string): Promise<Candidate | undefined>; loadEvidence(candidateId: string): Promise<readonly Memory[]>; loadCurrentValue(agentId: string, target: Candidate["target"]): Promise<string>; commit(review: ReviewCommit): Promise<void>; }

export class LongTermReviewService {
  constructor(private readonly repository: LongTermReviewRepository, private readonly harness: ReviewHarness) {}
  async review(candidateId: string, signal: AbortSignal): Promise<ReviewOutput> {
    const candidate = await this.repository.loadCandidate(candidateId); if (candidate === undefined) throw new DomainError("NOT_FOUND", "Candidate not found");
    const evidence = await this.repository.loadEvidence(candidateId);
    if (evidence.length === 0 || candidate.evidenceMemoryIds.some((id) => !evidence.some((memory) => memory.id === id)) || evidence.some((memory) => memory.agentId !== candidate.agentId)) throw new DomainError("VALIDATION", "Candidate evidence is missing or belongs to another agent");
    const currentValue = await this.repository.loadCurrentValue(candidate.agentId, candidate.target);
    const output = ReviewOutputSchema.parse(await this.harness.review({ candidate, evidence: [...evidence], currentValue }, signal));
    const status = ({ KEEP: "kept", UPDATE: "applied", MERGE: "merged", DROP: "dropped" } as const)[output.decision];
    await this.repository.commit({ candidateId, agentId: candidate.agentId, target: candidate.target, status, before: currentValue, ...(output.value === undefined ? {} : { after: output.value }), reason: output.reason, evidenceMemoryIds: candidate.evidenceMemoryIds });
    return output;
  }
}

export function compactNaturalLanguage(values: readonly string[], maxItems: number): readonly string[] {
  const unique = [...new Set(values.map((value) => value.trim()).filter(Boolean))];
  if (unique.length <= maxItems) return unique;
  return [...unique.slice(0, Math.max(0, maxItems - 1)), unique.slice(Math.max(0, maxItems - 1)).join("; ")];
}
