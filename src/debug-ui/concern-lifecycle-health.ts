export type LifecycleConcern = { readonly id: string; readonly status: string; readonly description: string; };
export type LifecycleActivity = { readonly kind: string; };

/** Read-only lifecycle view. It never decides a Concern lifecycle operation. */
export function concernLifecycleHealth(concerns: readonly LifecycleConcern[], activities: readonly LifecycleActivity[]) {
  const activityCounts = activities.reduce<Record<string, number>>((counts, activity) => ({ ...counts, [activity.kind]: (counts[activity.kind] ?? 0) + 1 }), {});
  const statuses = concerns.reduce<Record<string, number>>((counts, concern) => ({ ...counts, [concern.status]: (counts[concern.status] ?? 0) + 1 }), {});
  return { current: { total: concerns.length, active: statuses.active ?? 0, satisfied: statuses.satisfied ?? 0, abandoned: statuses.abandoned ?? 0 }, activities: { created: activityCounts.created ?? 0, derived: activityCounts.derived ?? 0, focused: activityCounts.focused ?? 0, progressed: activityCounts.progressed ?? 0, reviewed: activityCounts.reviewed ?? 0 } };
}
