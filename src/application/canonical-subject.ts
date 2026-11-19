import type { Observation } from "../domain/contracts.js";

export const userMainSubjectId = "user-main";

export type CanonicalSubjectResolver = {
  readonly resolve: (actor: Observation["actor"] | undefined) => string | undefined;
  /** Raw transport actor IDs are retained only for event audit/filtering. */
  readonly actorIdsFor: (subjectId: string) => readonly string[];
};

export function createCanonicalSubjectResolver(ownerIds: readonly string[]): CanonicalSubjectResolver {
  const owners = new Set(ownerIds);
  return {
    resolve: (actor) => actor?.type === "human" && owners.has(actor.id) ? userMainSubjectId : undefined,
    actorIdsFor: (subjectId) => subjectId === userMainSubjectId ? [...owners] : []
  };
}
