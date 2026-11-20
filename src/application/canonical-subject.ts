import type { Observation } from "../domain/contracts.js";
import type { AgentPeer } from "../config/agent-peers.js";

export const userMainSubjectId = "user-main";

export type CanonicalSubjectResolver = {
  readonly resolve: (actor: Observation["actor"] | undefined) => string | undefined;
  /** Raw transport actor IDs are retained only for event audit/filtering. */
  readonly actorIdsFor: (subjectId: string) => readonly string[];
};

export function createCanonicalSubjectResolver(ownerIds: readonly string[], peers: readonly AgentPeer[] = []): CanonicalSubjectResolver {
  const owners = new Set(ownerIds);
  const peerByDiscordId = new Map(peers.map((peer) => [peer.discordUserId, peer]));
  return {
    resolve: (actor) => actor?.type === "human" && owners.has(actor.id) ? userMainSubjectId : actor?.type === "agent" ? peerByDiscordId.get(actor.id) === undefined ? undefined : `agent:${peerByDiscordId.get(actor.id)?.agentId}` : undefined,
    actorIdsFor: (subjectId) => subjectId === userMainSubjectId ? [...owners] : peers.filter((peer) => subjectId === `agent:${peer.agentId}`).map((peer) => peer.discordUserId)
  };
}
