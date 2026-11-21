import { z } from "zod";

import type { DomainEvent } from "../domain/contracts.js";

export const ObservationGateDecisionSchema = z.object({
  decision: z.enum(["ignore", "engage"]).describe("ignore は通常Loopへ渡さず監査だけ残す。engage は通常の peer/observed Loopへ渡す。"),
  reason: z.string().min(1).max(240).describe("engageなら、投稿の具体的対象と、自分の未解決の問い・判断を変える差分・Concern又は約束の次行為・今言いたい自発表現のどれが動いたかを書く。ignoreなら、それがないことを書く。長期協力、礼儀、採用、感謝、同意、言い換え、相手への有用性、返信義務を理由にしない。")
}).strict();
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
