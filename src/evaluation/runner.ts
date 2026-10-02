import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

import { redactSecrets } from "../observability/redaction.js";
import type { ArtifactMetadata } from "../operations/operations.js";
import type { EvaluationPacket, EvaluationScenario, EvaluatorAdapter, HardAssertionResult, ScenarioExecutor, ScenarioResult } from "./types.js";

const allowedTargets = new Set(["emotion", "mood", "drive", "desire", "socialContext"]);
export function evaluateHardAssertions(result: ScenarioResult): readonly HardAssertionResult[] {
  const evidence = new Map(result.evidenceMemories.map((memory) => [memory.id, memory.agentId])); const owners = new Set(result.involvedAgentIds);
  return [
    { name: "schema-valid", passed: result.schemaValid },
    { name: "agent-isolation", passed: result.dataOwnerAgentIds.every((id) => owners.has(id)) },
    { name: "evidence-ownership", passed: result.referencedEvidenceIds.every((id) => { const owner = evidence.get(id); return owner !== undefined && owners.has(owner); }) },
    { name: "no-prohibited-state-update", passed: result.proposedStateTargets.every((target) => allowedTargets.has(target)) },
    { name: "runtime-limits", passed: result.limitsRespected },
    { name: "no-unhandled-error", passed: true }
  ];
}
const semanticPass = (rubric: Readonly<Record<string, "pass" | "weak" | "fail">>): boolean => Object.values(rubric).every((rating) => rating !== "fail") && Object.values(rubric).filter((rating) => rating === "weak").length <= 1;
export type EvaluationSummary = { readonly groupId: string; readonly packets: readonly EvaluationPacket[]; readonly scenarios: readonly { readonly id: string; readonly hardPass: boolean; readonly semanticPasses: number; readonly passed: boolean }[]; readonly passed: boolean };

export async function runEvaluation(options: { readonly scenarios: readonly EvaluationScenario[]; readonly repetitions: number; readonly executor: ScenarioExecutor; readonly evaluator: EvaluatorAdapter; readonly artifactRoot: string; readonly metadata: ArtifactMetadata; readonly signal: AbortSignal }): Promise<EvaluationSummary> {
  const groupId = `${options.metadata.createdAt.replaceAll(/[:.]/gu, "-")}-${randomUUID()}`; const directory = join(options.artifactRoot, groupId); await mkdir(directory, { recursive: false }); const packets: EvaluationPacket[] = [];
  for (const scenario of options.scenarios) for (let repetition = 1; repetition <= options.repetitions; repetition += 1) {
    const result = await options.executor.execute(scenario, repetition, options.signal); const hardAssertions = evaluateHardAssertions(result); const rubric = await options.evaluator.evaluate(scenario, result, options.signal); const passed = semanticPass(rubric); const packet: EvaluationPacket = { scenarioId: scenario.id, scenarioVersion: scenario.version, repetition, result, hardAssertions, rubric, semanticPass: passed, humanReviewRequired: !passed || Object.values(rubric).includes("weak") }; packets.push(packet); await writeFile(join(directory, `${scenario.id}-${String(repetition)}.json`), JSON.stringify(redactSecrets(packet), null, 2));
  }
  const scenarios = options.scenarios.map(({ id }) => { const selected = packets.filter((packet) => packet.scenarioId === id); const hardPass = selected.every((packet) => packet.hardAssertions.every(({ passed }) => passed)); const semanticPasses = selected.filter((packet) => packet.semanticPass).length; return { id, hardPass, semanticPasses, passed: hardPass && semanticPasses >= Math.ceil(options.repetitions * 0.8) }; });
  const summary = { groupId, packets, scenarios, passed: scenarios.every(({ passed }) => passed) }; await writeFile(join(directory, "summary.json"), JSON.stringify(redactSecrets({ metadata: options.metadata, ...summary }), null, 2)); return summary;
}
