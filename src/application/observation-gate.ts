import { z } from "zod";

import type { DomainEvent } from "../domain/contracts.js";

export const ObservationGateDecisionSchema = z.discriminatedUnion("decision", [
  z.object({ decision: z.literal("ignore"), reason: z.string().min(1).max(240) }).strict(),
  z.object({
    decision: z.literal("engage"),
    reason: z.string().min(1).max(240).describe("投稿の何が、今の自分を話しかける方向へ動かしたか"),
    conversationGoal: z.string().trim().min(1).max(400).describe("話しかけることで何を知りたい、確かめたい、伝えたい、変えたいか。返信すること自体や礼儀をGoalにしない")
  }).strict()
]);
export type ObservationGateDecision = z.infer<typeof ObservationGateDecisionSchema>;

export type ObservationGateInput = {
  readonly text: string;
  readonly peerName: string;
  /** Compact current self-view; it is not a biography or a persistent identifier. */
  readonly self: { readonly disposition: string; readonly story: string };
  /** Current durable affective stance, not a requested response or plan. */
  readonly mood: string;
  readonly relationship?: string;
  readonly concerns: readonly string[];
  readonly memories: readonly string[];
  /** Most recent bounded self utterance to this peer, when one is available. */
  readonly recentSelfSpeech?: string;
};

export interface ObservationGateModel {
  decide(input: ObservationGateInput, signal: AbortSignal): Promise<ObservationGateDecision>;
}

export interface ObservationGateContextLoader {
  load(event: DomainEvent, signal: AbortSignal): Promise<ObservationGateInput>;
}

export type ObservationGateAudit = ObservationGateDecision & {
  /** Exact bounded, ID-free model view used for this classification, when loading it succeeded. */
  readonly input?: ObservationGateInput;
  readonly modelCalls: number;
  readonly retrievalCount: number;
  readonly failureReason?: string;
};

/**
 * The Gate is deliberately not an Agent Core. It has no tools, no continuation,
 * and no authority to change persistent state; it only decides whether an
 * observed peer post deserves a normal social Event run.
 */
export class ObservationGate {
  constructor(private readonly context: ObservationGateContextLoader, private readonly model: ObservationGateModel) {}

  async decide(event: DomainEvent, signal: AbortSignal): Promise<ObservationGateAudit> {
    let input: ObservationGateInput;
    try {
      input = await this.context.load(event, signal);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // A non-mentioned peer post has no response obligation.  On a Gate
      // failure, do not turn an optional observation into an Agent Core run.
      return { decision: "ignore", reason: "Gateを判定できなかったため観測だけを記録する", modelCalls: 0, retrievalCount: 0, failureReason: message.slice(0, 1_000) };
    }
    try {
      const decision = ObservationGateDecisionSchema.parse(await this.model.decide(input, signal));
      return { ...decision, input, modelCalls: 1, retrievalCount: 1 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { decision: "ignore", reason: "Gateを判定できなかったため観測だけを記録する", input, modelCalls: 1, retrievalCount: 1, failureReason: message.slice(0, 1_000) };
    }
  }
}
