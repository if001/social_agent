import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { recordHumanReview, runEvaluation } from "../../src/evaluation/runner.js";
import { evaluationScenarios } from "../../src/evaluation/scenarios.js";
import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";

describe("live evaluation runner", () => {
  it("runs seven isolated scenarios five times and writes traceable, secret-free artifacts", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope);
    const summary = await runEvaluation({ scenarios: evaluationScenarios, repetitions: 5, executor: { execute: (scenario) => Promise.resolve({ input: scenario.events, output: { action: "respond" }, stateDiff: { mood: "curious" }, evidenceMemories: [{ id: `${scenario.id}-memory`, agentId: "agent-a" }], referencedEvidenceIds: [`${scenario.id}-memory`], toolTrace: [], involvedAgentIds: ["agent-a"], dataOwnerAgentIds: ["agent-a"], proposedStateTargets: ["mood"], limitsRespected: true, schemaValid: true }) }, evaluator: { evaluate: (scenario) => Promise.resolve(Object.fromEntries(scenario.semanticRubric.map((item) => [item, "pass" as const]))) }, artifactRoot: root, metadata: { createdAt: "2026-01-01T00:00:00.000Z", buildRevision: "abc", promptVersion: "v1", config: { OLLAMA_API_KEY: "secret" } }, signal: new AbortController().signal });
    expect(summary.packets).toHaveLength(35); expect(summary.passed).toBe(true); expect(summary.scenarios.every(({ semanticPasses }) => semanticPasses === 5)).toBe(true);
    const path = join(root, summary.groupId, "summary.json"); await access(path); expect(await readFile(path, "utf8")).not.toContain("secret"); await scope.close();
  });
  it("requires all hard assertions and four of five semantic passes", async () => {
    let repetition = 0; const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const scenario = evaluationScenarios[0]; if (scenario === undefined) throw new Error("missing fixture");
    const summary = await runEvaluation({ scenarios: [scenario], repetitions: 5, executor: { execute: () => Promise.resolve({ input: {}, output: {}, stateDiff: {}, evidenceMemories: [], referencedEvidenceIds: [], toolTrace: [], involvedAgentIds: ["a"], dataOwnerAgentIds: ["a"], proposedStateTargets: [], limitsRespected: true, schemaValid: true }) }, evaluator: { evaluate: (value) => { repetition += 1; return Promise.resolve(Object.fromEntries(value.semanticRubric.map((item) => [item, repetition === 1 ? "fail" : "pass"]))); } }, artifactRoot: root, metadata: { createdAt: "2026-01-01T00:00:00Z", buildRevision: "x", promptVersion: "v", config: {} }, signal: new AbortController().signal });
    expect(summary.scenarios[0]).toMatchObject({ hardPass: true, semanticPasses: 4, passed: true }); await scope.close();
  });
  it("records human review once without overwriting it", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const review = { scenarioId: "EV-01", repetition: 1, reviewer: "owner", decision: "pass" as const, notes: "Evidence is traceable", reviewedAt: "2026-01-01T00:00:00Z" };
    await recordHumanReview(root, review); await expect(recordHumanReview(root, review)).rejects.toMatchObject({ code: "EEXIST" }); await scope.close();
  });
});
