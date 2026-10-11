import { z } from "zod";
import type { AgentCoreInput } from "../domain/contracts.js";

export const RubricRatingSchema = z.enum(["pass", "weak", "fail"]);
export type RubricRating = z.infer<typeof RubricRatingSchema>;
export type ScenarioVariant = "baseline" | "stateful";
export type PairExpectation = {
  readonly changedStatePaths: readonly string[];
  readonly observationMetrics: readonly BehaviorLabel[];
  readonly expectedDirection: Readonly<Partial<Record<BehaviorLabel, "increase" | "decrease">>>;
  readonly stateCarryover: "isolated" | "within-variant-turns";
  readonly initialState: "reset-per-repetition";
};
export type EvaluationScenario = { readonly id: string; readonly version: string; readonly title: string; readonly pairId: string; readonly variant: ScenarioVariant; readonly pairExpectation: PairExpectation; readonly agentCoreInputs: readonly AgentCoreInput[]; readonly evidenceMemories: readonly { readonly id: string; readonly agentId: string }[]; readonly involvedAgentIds: readonly string[]; readonly maxToolCalls: number; readonly hardAssertions: readonly string[]; readonly semanticRubric: readonly string[]; readonly overallRule: "no-fail-at-most-one-weak" };
export type BehaviorLabel = "question" | "share" | "refuse" | "emotion-expression" | "digression" | "tool" | "no-external-action";
export type ScenarioResult = { readonly input: unknown; readonly output: unknown; readonly stateDiff: unknown; readonly evidenceMemories: readonly { readonly id: string; readonly agentId: string }[]; readonly referencedEvidenceIds: readonly string[]; readonly evidenceOwnershipValid: boolean; readonly toolTrace: readonly unknown[]; readonly involvedAgentIds: readonly string[]; readonly dataOwnerAgentIds: readonly string[]; readonly proposedStateTargets: readonly string[]; readonly limitsRespected: boolean; readonly schemaValid: boolean; readonly behaviorLabels?: readonly BehaviorLabel[]; readonly deliverySucceeded?: boolean; readonly deliveryRecords?: readonly unknown[]; readonly nextState?: unknown; readonly failureKind?: "wiring" | "schema" | "tool" | "timeout" | "semantic" | "delivery"; readonly failureStage?: string };
export type HardAssertionResult = { readonly name: string; readonly passed: boolean; readonly detail?: string };
export type EvaluationPacket = { readonly scenarioId: string; readonly scenarioVersion: string; readonly repetition: number; readonly result: ScenarioResult; readonly hardAssertions: readonly HardAssertionResult[]; readonly rubric: Readonly<Record<string, RubricRating>>; readonly semanticPass: boolean; readonly humanReviewRequired: boolean; readonly evaluationFailure?: { readonly stage: "evaluator"; readonly kind: "timeout" | "error"; readonly message: string } };
export interface ScenarioExecutor { execute(scenario: EvaluationScenario, repetition: number, signal: AbortSignal): Promise<ScenarioResult>; }
export interface EvaluatorAdapter { evaluate(scenario: EvaluationScenario, result: ScenarioResult, signal: AbortSignal): Promise<Readonly<Record<string, RubricRating>>>; }
