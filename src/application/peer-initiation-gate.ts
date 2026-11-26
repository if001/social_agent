import { z } from "zod";

import type { AgentCoreInput } from "../domain/contracts.js";

export type PeerCandidate = { readonly agentId: string; readonly displayName: string; readonly discordUserId: string; readonly channelId: string };
export const PeerInitiationDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("ignore"), reason: z.string().trim().min(1).max(240) }).strict(),
  z.object({ decision: z.literal("initiate"), peerName: z.string().trim().min(1).max(120).describe("allowlistにある自然言語の表示名だけ。IDは出力しない"), reason: z.string().trim().min(1).max(240).describe("このpeerへ今始める自分自身の具体的動機") }).strict()
]);
export type PeerInitiationDecision = z.infer<typeof PeerInitiationDecisionSchema>;

export interface PeerInitiationModel {
  decide(input: AgentCoreInput, peers: readonly { readonly displayName: string }[], signal: AbortSignal): Promise<PeerInitiationDecision>;
}

/** Optional autonomous preflight. It may choose no peer, but it never sends. */
export class PeerInitiationGate {
  constructor(private readonly model: PeerInitiationModel) {}
  async decide(input: AgentCoreInput, peers: readonly PeerCandidate[], signal: AbortSignal): Promise<{ readonly decision: PeerInitiationDecision; readonly peer?: PeerCandidate }> {
    const decision = PeerInitiationDecisionSchema.parse(await this.model.decide(input, peers.map(({ displayName }) => ({ displayName })), signal));
    if (decision.decision === "ignore") return { decision };
    const matches = peers.filter(({ displayName }) => displayName.normalize("NFKC").toLocaleLowerCase("ja") === decision.peerName.normalize("NFKC").toLocaleLowerCase("ja"));
    const peer = matches.length === 1 ? matches[0] : undefined;
    return peer === undefined ? { decision: { decision: "ignore", reason: "allowlist peerを一意に解決できなかった" } } : { decision, peer };
  }
}
