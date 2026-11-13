export type ReactivationReason = "formation" | "concern" | "unreviewed" | "distant";
export type ReactivationCandidate = {
  readonly memoryId: string;
  readonly reason: ReactivationReason;
  readonly occurredAt: string;
};

/** FR-72: choose at most one anchor per reason and four per Session. */
export function selectReactivationAnchors(candidates: readonly ReactivationCandidate[]): readonly ReactivationCandidate[] {
  const reasons: readonly ReactivationReason[] = ["formation", "concern", "unreviewed", "distant"];
  const selected: ReactivationCandidate[] = [];
  const seen = new Set<string>();
  for (const reason of reasons) {
    const candidate = candidates
      .filter((value) => value.reason === reason && !seen.has(value.memoryId))
      .sort((left, right) => right.occurredAt.localeCompare(left.occurredAt) || left.memoryId.localeCompare(right.memoryId))[0];
    if (candidate !== undefined) { selected.push(candidate); seen.add(candidate.memoryId); }
  }
  return selected;
}
