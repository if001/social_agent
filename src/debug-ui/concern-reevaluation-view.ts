export type ConcernActivityProjection = {
  readonly kind?: string;
  readonly description?: string;
  readonly sourceConcernDescription?: string;
  readonly reason?: string | null;
  readonly evidenceMemoryIds?: readonly string[];
  readonly eventKind?: string | null;
  readonly eventSummary?: string | null;
  readonly occurredAt?: string;
};

export type ConcernDueProjection = {
  readonly event?: { readonly internalKind?: string | null; readonly observation?: { readonly content?: { readonly targetKind?: string } } };
  readonly run?: { readonly failureReason?: string | null } | null;
  readonly concernActivities?: readonly ConcernActivityProjection[];
};

/** Read-only view model: Activity is the durable audit trail; a signal is not. */
export function concernLineage(activities: readonly ConcernActivityProjection[]) {
  return activities.filter((item) => item.kind === "derived").map((item) => ({
    parent: item.sourceConcernDescription || "親Concernなし",
    child: item.description || "子Concernなし",
    reason: item.reason || "—",
    evidenceMemoryIds: item.evidenceMemoryIds || [],
    event: item.eventKind || "—",
    eventSummary: item.eventSummary || "—",
    occurredAt: item.occurredAt
  }));
}

/** A no-op or retry is a Concern re-evaluation result, never a delivery failure. */
export function concernDueOutcome(detail: ConcernDueProjection) {
  const eventKind = detail.event?.internalKind || detail.event?.observation?.content?.targetKind;
  if (eventKind !== "concern-due") return undefined;
  if (detail.run?.failureReason) {
    return { result: "再試行待ち", reason: detail.run.failureReason, delivery: "配送失敗ではなく、Concern再評価の実行失敗" };
  }
  const derived = (detail.concernActivities || []).filter((item) => item.kind === "derived");
  return derived.length === 0
    ? { result: "派生なし（no-op）", delivery: "外部発話・配送の失敗ではない" }
    : { result: "派生を確定", derivedCount: derived.length, delivery: "外部発話の有無とは独立したConcern更新" };
}
