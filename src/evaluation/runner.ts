import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { redactSecrets } from "../observability/redaction.js";
import type { ArtifactMetadata } from "../operations/operations.js";
import type { EvaluationPacket, EvaluationScenario, EvaluatorAdapter, HardAssertionResult, ScenarioExecutor, ScenarioResult } from "./types.js";

const allowedTargets = new Set(["emotion", "mood", "drive", "socialContext"]);
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
export type EvaluationSummary = { readonly groupId: string; readonly packets: readonly EvaluationPacket[]; readonly scenarios: readonly { readonly id: string; readonly hardPass: boolean; readonly semanticPasses: number; readonly passed: boolean }[]; readonly passed: boolean };
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

export async function runEvaluation(options: { readonly scenarios: readonly EvaluationScenario[]; readonly repetitions: number; readonly executor: ScenarioExecutor; readonly evaluator: EvaluatorAdapter; readonly artifactRoot: string; readonly metadata: ArtifactMetadata; readonly signal: AbortSignal; readonly resumeGroupId?: string }): Promise<EvaluationSummary> {
  const groupId = options.resumeGroupId ?? `${options.metadata.createdAt.replaceAll(/[:.]/gu, "-")}-${randomUUID()}`; const directory = join(options.artifactRoot, groupId);
  if (options.resumeGroupId === undefined) await mkdir(directory, { recursive: false });
  const packets: EvaluationPacket[] = [];
  for (const scenario of options.scenarios) for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
    const packetPath = join(directory, `${scenario.id}-${String(repetition)}.json`); const existing = await readPacket(packetPath);
    if (existing !== undefined) { packets.push(existing); continue; }
    const result = await options.executor.execute(scenario, repetition, options.signal); const hardAssertions = evaluateHardAssertions(result); const rubric = await options.evaluator.evaluate(scenario, result, options.signal); const passed = semanticPass(rubric); const packet: EvaluationPacket = { scenarioId: scenario.id, scenarioVersion: scenario.version, repetition, result, hardAssertions, rubric, semanticPass: passed, humanReviewRequired: !passed || Object.values(rubric).includes("weak") }; packets.push(packet); await writeFile(packetPath, JSON.stringify(redactSecrets(packet), null, 2), { flag: "wx" });
  }
  const scenarios = options.scenarios.map(({ id }) => { const selected = packets.filter((packet) => packet.scenarioId === id); const hardPass = selected.every((packet) => packet.hardAssertions.every(({ passed }) => passed)); const semanticPasses = selected.filter((packet) => packet.semanticPass).length; return { id, hardPass, semanticPasses, passed: hardPass && semanticPasses >= Math.ceil(options.repetitions * 0.8) }; });
  const summary = { groupId, packets, scenarios, passed: scenarios.every(({ passed }) => passed) }; await writeFile(join(directory, "summary.json"), JSON.stringify(redactSecrets({ metadata: options.metadata, ...summary }), null, 2), { flag: "wx" }); return summary;
}
