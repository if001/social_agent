import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { redactSecrets } from "../observability/redaction.js";
import type { ArtifactMetadata } from "../operations/operations.js";
import { DomainError } from "../domain/contracts.js";
import type { BehaviorLabel, EvaluationPacket, EvaluationScenario, EvaluatorAdapter, HardAssertionResult, ScenarioExecutor, ScenarioResult } from "./types.js";

const allowedTargets = new Set(["mood", "concern", "relationship"]);
export function evaluateHardAssertions(result: ScenarioResult): readonly HardAssertionResult[] {
  const owners = new Set(result.involvedAgentIds);
  return [
    { name: "schema-valid", passed: result.schemaValid },
    { name: "agent-isolation", passed: result.dataOwnerAgentIds.every((id) => owners.has(id)) },
    { name: "evidence-ownership", passed: result.evidenceOwnershipValid },
    { name: "no-prohibited-state-update", passed: result.proposedStateTargets.every((target) => allowedTargets.has(target)) },
    { name: "runtime-limits", passed: result.limitsRespected },
    { name: "no-unhandled-error", passed: true }
  ];
}
const semanticPass = (rubric: Readonly<Record<string, "pass" | "weak" | "fail">>): boolean => Object.values(rubric).every((rating) => rating !== "fail") && Object.values(rubric).filter((rating) => rating === "weak").length <= 1;
export type PairSummary = { readonly pairId: string; readonly repetitions: number; readonly baselineCount: number; readonly statefulCount: number; readonly minimumEffectRate: number; readonly behaviorRateDelta: Readonly<Record<string, number>>; readonly behaviorRateDelta95Interval: Readonly<Record<string, readonly [number, number]>>; readonly observedExpectedDifference: boolean; readonly passed: boolean };
export type EvaluationSummary = { readonly groupId: string; readonly packets: readonly EvaluationPacket[]; readonly scenarios: readonly { readonly id: string; readonly hardPass: boolean; readonly semanticPasses: number; readonly passed: boolean; readonly behaviorCounts: Readonly<Record<string, number>>; readonly failureCounts: Readonly<Record<string, number>> }[]; readonly pairs: readonly PairSummary[]; readonly passed: boolean };
export type HumanReview = { readonly scenarioId: string; readonly repetition: number; readonly reviewer: string; readonly decision: "pass" | "fail"; readonly notes: string; readonly reviewedAt: string };

function wilson(successes: number, total: number): readonly [number, number] { if (total === 0) return [0, 1]; const z = 1.96; const p = successes / total; const denominator = 1 + z ** 2 / total; const center = (p + z ** 2 / (2 * total)) / denominator; const margin = z * Math.sqrt((p * (1 - p) + z ** 2 / (4 * total)) / total) / denominator; return [Math.max(0, center - margin), Math.min(1, center + margin)]; }

export async function recordHumanReview(groupDirectory: string, review: HumanReview): Promise<void> {
  const safeScenario = review.scenarioId.replaceAll(/[^A-Za-z0-9_-]/gu, "_");
  await writeFile(join(groupDirectory, `human-review-${safeScenario}-${String(review.repetition)}.json`), JSON.stringify(redactSecrets(review), null, 2), { flag: "wx" });
}

async function readPacket(path: string): Promise<EvaluationPacket | undefined> {
  try { return JSON.parse(await readFile(path, "utf8")) as EvaluationPacket; } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

export async function runEvaluation(options: { readonly scenarios: readonly EvaluationScenario[]; readonly repetitions: number; readonly minimumRepetitions?: number; readonly concurrency?: number; readonly executor: ScenarioExecutor; readonly evaluator: EvaluatorAdapter; readonly artifactRoot: string; readonly metadata: ArtifactMetadata; readonly signal: AbortSignal; readonly resumeGroupId?: string }): Promise<EvaluationSummary> {
  if (options.repetitions < (options.minimumRepetitions ?? 1)) throw new Error(`Evaluation requires at least ${String(options.minimumRepetitions ?? 1)} repetitions`);
  const groupId = options.resumeGroupId ?? `${options.metadata.createdAt.replaceAll(/[:.]/gu, "-")}-${randomUUID()}`; const directory = join(options.artifactRoot, groupId);
  if (options.resumeGroupId === undefined) await mkdir(directory, { recursive: false });
  const packets: EvaluationPacket[] = [];
  const tasks = options.scenarios.flatMap((scenario) => Array.from({ length: options.repetitions }, (_, index) => ({ scenario, repetition: index + 1 }))); let cursor = 0;
  const worker = async (): Promise<void> => { while (cursor < tasks.length) {
    const task = tasks[cursor]; cursor += 1; if (task === undefined) return; const { scenario, repetition } = task;
    const packetPath = join(directory, `${scenario.id}-${String(repetition)}.json`); const existing = await readPacket(packetPath);
    if (existing !== undefined) { packets.push(existing); continue; }
    const result = await options.executor.execute(scenario, repetition, options.signal); const hardAssertions = evaluateHardAssertions(result);
    let rubric: Readonly<Record<string, "pass" | "weak" | "fail">>; let evaluationFailure: EvaluationPacket["evaluationFailure"];
    try { rubric = await options.evaluator.evaluate(scenario, result, options.signal); }
    catch (error) { const message = error instanceof Error ? error.message : "Evaluator failed"; evaluationFailure = { stage: "evaluator", kind: error instanceof DomainError && error.code === "TIMEOUT" || /timeout/iu.test(message) ? "timeout" : "error", message }; rubric = Object.fromEntries(scenario.semanticRubric.map((item) => [item, "fail" as const])); }
    const passed = evaluationFailure === undefined && semanticPass(rubric); const packet: EvaluationPacket = { scenarioId: scenario.id, scenarioVersion: scenario.version, repetition, result, hardAssertions, rubric, semanticPass: passed, humanReviewRequired: !passed || Object.values(rubric).includes("weak"), ...(evaluationFailure === undefined ? {} : { evaluationFailure }) }; packets.push(packet); await writeFile(packetPath, JSON.stringify(redactSecrets(packet), null, 2), { flag: "wx" });
  } };
  const concurrency = Math.max(1, Math.min(options.concurrency ?? 1, tasks.length)); await Promise.all(Array.from({ length: concurrency }, worker));
  const scenarios = options.scenarios.map(({ id }) => { const selected = packets.filter((packet) => packet.scenarioId === id); const hardPass = selected.every((packet) => packet.hardAssertions.every(({ passed }) => passed)); const semanticPasses = selected.filter((packet) => packet.semanticPass).length; const count = (values: readonly string[]) => values.reduce<Record<string, number>>((result, value) => ({ ...result, [value]: (result[value] ?? 0) + 1 }), {}); const behaviorCounts = count(selected.flatMap(({ result }) => result.behaviorLabels ?? [])); const failureCounts = count(selected.flatMap(({ result, semanticPass, evaluationFailure }) => evaluationFailure !== undefined ? [`evaluator-${evaluationFailure.kind}`] : result.failureKind === undefined ? semanticPass ? [] : ["semantic"] : [result.failureKind])); return { id, hardPass, semanticPasses, passed: hardPass && semanticPasses >= Math.ceil(options.repetitions * 0.8), behaviorCounts, failureCounts }; });
  const pairIds = [...new Set(options.scenarios.map(({ pairId }) => pairId))];
  const pairs: PairSummary[] = pairIds.map((pairId) => {
    const baselineScenario = options.scenarios.find((item) => item.pairId === pairId && item.variant === "baseline"); const statefulScenario = options.scenarios.find((item) => item.pairId === pairId && item.variant === "stateful");
    const baseline = baselineScenario === undefined ? [] : packets.filter(({ scenarioId }) => scenarioId === baselineScenario.id); const stateful = statefulScenario === undefined ? [] : packets.filter(({ scenarioId }) => scenarioId === statefulScenario.id);
    const metrics = baselineScenario?.pairExpectation.observationMetrics ?? []; const successes = (selected: readonly EvaluationPacket[], metric: BehaviorLabel) => selected.filter(({ result }) => result.behaviorLabels?.includes(metric) === true).length; const rate = (selected: readonly EvaluationPacket[], metric: BehaviorLabel) => successes(selected, metric) / options.repetitions;
    const behaviorRateDelta = Object.fromEntries(metrics.map((metric) => [metric, rate(stateful, metric) - rate(baseline, metric)]));
    const behaviorRateDelta95Interval = Object.fromEntries(metrics.map((metric) => { const baselineInterval = wilson(successes(baseline, metric), options.repetitions); const statefulInterval = wilson(successes(stateful, metric), options.repetitions); return [metric, [statefulInterval[0] - baselineInterval[1], statefulInterval[1] - baselineInterval[0]] as const]; }));
    const minimumEffectRate = 2 / options.repetitions; const directions = baselineScenario?.pairExpectation.expectedDirection ?? {}; const observedExpectedDifference = Object.entries(directions).some(([metric, direction]) => direction === "increase" ? (behaviorRateDelta[metric] ?? 0) >= minimumEffectRate : (behaviorRateDelta[metric] ?? 0) <= -minimumEffectRate);
    const scenarioPass = [baselineScenario, statefulScenario].every((item) => item !== undefined && scenarios.find(({ id }) => id === item.id)?.passed === true);
    return { pairId, repetitions: options.repetitions, baselineCount: baseline.length, statefulCount: stateful.length, minimumEffectRate, behaviorRateDelta, behaviorRateDelta95Interval, observedExpectedDifference, passed: baseline.length === options.repetitions && stateful.length === options.repetitions && observedExpectedDifference && scenarioPass };
  });
  const summary = { groupId, packets, scenarios, pairs, passed: scenarios.every(({ passed }) => passed) && pairs.every(({ passed }) => passed) }; await writeFile(join(directory, "summary.json"), JSON.stringify(redactSecrets({ metadata: options.metadata, ...summary }), null, 2), { flag: "wx" }); return summary;
}
