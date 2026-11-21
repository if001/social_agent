import { z } from "zod";

import type { DomainEvent } from "../domain/contracts.js";

export const ObservationGateDecisionSchema = z.object({
  decision: z.enum(["ignore", "engage"]).describe("ignore は通常Loopへ渡さず監査だけ残す。engage は通常の peer/observed Loopへ渡す。"),
  reason: z.string().min(1).max(240).describe("投稿がSelf・Mood・関係・Memory・Concernの何を動かし、Agent自身が知りたい・言いたい等と感じたか、又は動かなかったかを短く説明する。返信義務や相手への有用性を理由にしない。")
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
      // Losing an observed peer post due to infrastructure/model trouble is a
      // worse failure than spending one normal run. The normal loop remains
      // authoritative and will record its own result.
      return { decision: "engage", reason: "Gateを判定できなかったため通常の観測として扱う", modelCalls: 0, retrievalCount: 0, failureReason: message.slice(0, 1_000) };
    }
    try {
      const decision = ObservationGateDecisionSchema.parse(await this.model.decide(input, signal));
      return { ...decision, input, modelCalls: 1, retrievalCount: 1 };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { decision: "engage", reason: "Gateを判定できなかったため通常の観測として扱う", input, modelCalls: 1, retrievalCount: 1, failureReason: message.slice(0, 1_000) };
    }
  }
}
