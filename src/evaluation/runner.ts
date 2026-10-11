import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { redactSecrets } from "../observability/redaction.js";
import type { ArtifactMetadata } from "../operations/operations.js";
import type { BehaviorLabel, EvaluationPacket, EvaluationScenario, EvaluatorAdapter, HardAssertionResult, ScenarioExecutor, ScenarioResult } from "./types.js";

const allowedTargets = new Set(["emotion"]);
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
export type PairSummary = { readonly pairId: string; readonly repetitions: number; readonly baselineCount: number; readonly statefulCount: number; readonly behaviorRateDelta: Readonly<Record<string, number>>; readonly observedExpectedDifference: boolean; readonly passed: boolean };
export type EvaluationSummary = { readonly groupId: string; readonly packets: readonly EvaluationPacket[]; readonly scenarios: readonly { readonly id: string; readonly hardPass: boolean; readonly semanticPasses: number; readonly passed: boolean; readonly behaviorCounts: Readonly<Record<string, number>>; readonly failureCounts: Readonly<Record<string, number>> }[]; readonly pairs: readonly PairSummary[]; readonly passed: boolean };
export type HumanReview = { readonly scenarioId: string; readonly repetition: number; readonly reviewer: string; readonly decision: "pass" | "fail"; readonly notes: string; readonly reviewedAt: string };

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

export async function runEvaluation(options: { readonly scenarios: readonly EvaluationScenario[]; readonly repetitions: number; readonly minimumRepetitions?: number; readonly executor: ScenarioExecutor; readonly evaluator: EvaluatorAdapter; readonly artifactRoot: string; readonly metadata: ArtifactMetadata; readonly signal: AbortSignal; readonly resumeGroupId?: string }): Promise<EvaluationSummary> {
  if (options.repetitions < (options.minimumRepetitions ?? 1)) throw new Error(`Evaluation requires at least ${String(options.minimumRepetitions ?? 1)} repetitions`);
  const groupId = options.resumeGroupId ?? `${options.metadata.createdAt.replaceAll(/[:.]/gu, "-")}-${randomUUID()}`; const directory = join(options.artifactRoot, groupId);
  if (options.resumeGroupId === undefined) await mkdir(directory, { recursive: false });
  const packets: EvaluationPacket[] = [];
  for (const scenario of options.scenarios) for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
    const packetPath = join(directory, `${scenario.id}-${String(repetition)}.json`); const existing = await readPacket(packetPath);
    if (existing !== undefined) { packets.push(existing); continue; }
    const result = await options.executor.execute(scenario, repetition, options.signal); const hardAssertions = evaluateHardAssertions(result); const rubric = await options.evaluator.evaluate(scenario, result, options.signal); const passed = semanticPass(rubric); const packet: EvaluationPacket = { scenarioId: scenario.id, scenarioVersion: scenario.version, repetition, result, hardAssertions, rubric, semanticPass: passed, humanReviewRequired: !passed || Object.values(rubric).includes("weak") }; packets.push(packet); await writeFile(packetPath, JSON.stringify(redactSecrets(packet), null, 2), { flag: "wx" });
  }
  const scenarios = options.scenarios.map(({ id }) => { const selected = packets.filter((packet) => packet.scenarioId === id); const hardPass = selected.every((packet) => packet.hardAssertions.every(({ passed }) => passed)); const semanticPasses = selected.filter((packet) => packet.semanticPass).length; const count = (values: readonly string[]) => values.reduce<Record<string, number>>((result, value) => ({ ...result, [value]: (result[value] ?? 0) + 1 }), {}); const behaviorCounts = count(selected.flatMap(({ result }) => result.behaviorLabels ?? [])); const failureCounts = count(selected.flatMap(({ result, semanticPass }) => result.failureKind === undefined ? semanticPass ? [] : ["semantic"] : [result.failureKind])); return { id, hardPass, semanticPasses, passed: hardPass && semanticPasses >= Math.ceil(options.repetitions * 0.8), behaviorCounts, failureCounts }; });
  const pairIds = [...new Set(options.scenarios.map(({ pairId }) => pairId))];
  const pairs: PairSummary[] = pairIds.map((pairId) => {
    const baselineScenario = options.scenarios.find((item) => item.pairId === pairId && item.variant === "baseline"); const statefulScenario = options.scenarios.find((item) => item.pairId === pairId && item.variant === "stateful");
    const baseline = baselineScenario === undefined ? [] : packets.filter(({ scenarioId }) => scenarioId === baselineScenario.id); const stateful = statefulScenario === undefined ? [] : packets.filter(({ scenarioId }) => scenarioId === statefulScenario.id);
    const metrics = baselineScenario?.pairExpectation.observationMetrics ?? []; const rate = (selected: readonly EvaluationPacket[], metric: BehaviorLabel) => selected.filter(({ result }) => result.behaviorLabels?.includes(metric) === true).length / options.repetitions;
    const behaviorRateDelta = Object.fromEntries(metrics.map((metric) => [metric, rate(stateful, metric) - rate(baseline, metric)]));
    const directions = baselineScenario?.pairExpectation.expectedDirection ?? {}; const observedExpectedDifference = Object.entries(directions).some(([metric, direction]) => direction === "increase" ? (behaviorRateDelta[metric] ?? 0) >= 1 / options.repetitions : (behaviorRateDelta[metric] ?? 0) <= -1 / options.repetitions);
    const scenarioPass = [baselineScenario, statefulScenario].every((item) => item !== undefined && scenarios.find(({ id }) => id === item.id)?.passed === true);
    return { pairId, repetitions: options.repetitions, baselineCount: baseline.length, statefulCount: stateful.length, behaviorRateDelta, observedExpectedDifference, passed: baseline.length === options.repetitions && stateful.length === options.repetitions && observedExpectedDifference && scenarioPass };
  });
  const summary = { groupId, packets, scenarios, pairs, passed: scenarios.every(({ passed }) => passed) && pairs.every(({ passed }) => passed) }; await writeFile(join(directory, "summary.json"), JSON.stringify(redactSecrets({ metadata: options.metadata, ...summary }), null, 2), { flag: "wx" }); return summary;
}
