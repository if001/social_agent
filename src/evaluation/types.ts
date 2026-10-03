import { z } from "zod";
import type { AgentCoreInput } from "../domain/contracts.js";

export const RubricRatingSchema = z.enum(["pass", "weak", "fail"]);
export type RubricRating = z.infer<typeof RubricRatingSchema>;
export type EvaluationScenario = { readonly id: string; readonly version: string; readonly title: string; readonly agentCoreInputs: readonly AgentCoreInput[]; readonly evidenceMemories: readonly { readonly id: string; readonly agentId: string }[]; readonly involvedAgentIds: readonly string[]; readonly maxToolCalls: number; readonly hardAssertions: readonly string[]; readonly semanticRubric: readonly string[]; readonly overallRule: "no-fail-at-most-one-weak" };
export type ScenarioResult = { readonly input: unknown; readonly output: unknown; readonly stateDiff: unknown; readonly evidenceMemories: readonly { readonly id: string; readonly agentId: string }[]; readonly referencedEvidenceIds: readonly string[]; readonly evidenceOwnershipValid: boolean; readonly toolTrace: readonly unknown[]; readonly involvedAgentIds: readonly string[]; readonly dataOwnerAgentIds: readonly string[]; readonly proposedStateTargets: readonly string[]; readonly limitsRespected: boolean; readonly schemaValid: boolean };
export type HardAssertionResult = { readonly name: string; readonly passed: boolean; readonly detail?: string };
export type EvaluationPacket = { readonly scenarioId: string; readonly scenarioVersion: string; readonly repetition: number; readonly result: ScenarioResult; readonly hardAssertions: readonly HardAssertionResult[]; readonly rubric: Readonly<Record<string, RubricRating>>; readonly semanticPass: boolean; readonly humanReviewRequired: boolean };
export interface ScenarioExecutor { execute(scenario: EvaluationScenario, repetition: number, signal: AbortSignal): Promise<ScenarioResult>; }
export interface EvaluatorAdapter { evaluate(scenario: EvaluationScenario, result: ScenarioResult, signal: AbortSignal): Promise<Readonly<Record<string, RubricRating>>>; }
