import { z } from "zod";

import type { DomainEvent } from "../domain/contracts.js";
import type { ObservationGateInput } from "./observation-gate.js";

export const ConversationGoalSchema = z.object({
  goal: z.string().trim().min(1).max(400).describe("この会話で自分が知りたい、確かめたい、伝えたい、又は変えたい具体的な目的。返信、礼儀、会話の継続そのものを目的にしない")
}).strict();
export type ConversationGoal = z.infer<typeof ConversationGoalSchema>;

export interface ConversationGoalContextLoader {
  load(event: DomainEvent, signal: AbortSignal): Promise<ObservationGateInput>;
}

export interface ConversationGoalModel {
  compose(input: ObservationGateInput, reason: string, signal: AbortSignal): Promise<ConversationGoal>;
}
export type ConversationGoalCompositionAudit = { readonly source: "observed" | "direct" | "peer-initiation"; readonly input?: ObservationGateInput; readonly reason: string; readonly goal?: string; readonly modelCalls: number; readonly retrievalCount: number; readonly failureReason?: string };

/** Creates a short-lived, agent-owned Conversation Goal before Agent Core. */
export class ConversationGoalComposer {
  constructor(private readonly context: ConversationGoalContextLoader, private readonly model: ConversationGoalModel) {}

  async compose(event: DomainEvent, reason: string, signal: AbortSignal): Promise<ConversationGoal> {
    return this.composeInput(await this.context.load(event, signal), reason, signal);
  }

  async composeInput(input: ObservationGateInput, reason: string, signal: AbortSignal): Promise<ConversationGoal> {
    return ConversationGoalSchema.parse(await this.model.compose(input, reason, signal));
  }

  async composeAudited(event: DomainEvent, source: ConversationGoalCompositionAudit["source"], reason: string, signal: AbortSignal): Promise<{ readonly goal?: ConversationGoal; readonly audit: ConversationGoalCompositionAudit }> {
    let input: ObservationGateInput;
    try { input = await this.context.load(event, signal); }
    catch (error) { return { audit: { source, reason, modelCalls: 0, retrievalCount: 0, failureReason: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000) } }; }
    try { const goal = await this.composeInput(input, reason, signal); return { goal, audit: { source, input, reason, goal: goal.goal, modelCalls: 1, retrievalCount: 1 } }; }
    catch (error) { return { audit: { source, input, reason, modelCalls: 1, retrievalCount: 1, failureReason: error instanceof Error ? error.message.slice(0, 1_000) : String(error).slice(0, 1_000) } }; }
  }
}
