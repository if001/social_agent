import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { runEvaluation } from "../../src/evaluation/runner.js";
import { evaluationScenarios } from "../../src/evaluation/scenarios.js";
import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";

describe("prediction evaluation artifacts", () => {
  it("FR-48, FR-57, FR-60, AC-18: saves prediction, MemoryUpdate and Background Experience artifacts", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope);
    const scenario = evaluationScenarios[0]; if (scenario === undefined) throw new Error("missing scenario");
    const summary = await runEvaluation({
      scenarios: [scenario], repetitions: 1,
      executor: { execute: () => Promise.resolve({ input: {}, output: {}, stateDiff: {}, evidenceMemories: [], referencedEvidenceIds: [], evidenceOwnershipValid: true, toolTrace: [], involvedAgentIds: ["agent-a"], dataOwnerAgentIds: ["agent-a"], proposedStateTargets: [], limitsRespected: true, schemaValid: true, predictionArtifacts: { predictions: [{ candidateIndex: 0, content: "技術の話" }], evaluations: [{ match: "primary" }], effect: "unchanged", latencyMs: 120 }, memoryUpdateArtifacts: [{ operation: "update", memoryId: "memory-1" }], backgroundExperienceArtifacts: [{ id: "aka-exp-0001", effect: "reduced" }] }) },
      evaluator: { evaluate: (value) => Promise.resolve(Object.fromEntries(value.semanticRubric.map((item) => [item, "pass" as const]))) },
      artifactRoot: root, metadata: { createdAt: "2026-01-01T00:00:00.000Z", buildRevision: "test", promptVersion: "test", config: {} }, signal: new AbortController().signal
    });
    const packet = JSON.parse(await readFile(join(root, summary.groupId, `${scenario.id}-1.json`), "utf8")) as { result: { predictionArtifacts: { latencyMs: number }; memoryUpdateArtifacts: unknown[]; backgroundExperienceArtifacts: unknown[] } };
    expect(packet.result.predictionArtifacts.latencyMs).toBe(120);
    expect(packet.result.memoryUpdateArtifacts).toHaveLength(1);
    expect(packet.result.backgroundExperienceArtifacts).toHaveLength(1);
    await scope.close();
  });
});
