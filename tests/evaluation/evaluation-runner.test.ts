import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { evaluateHardAssertions, recordHumanReview, runEvaluation } from "../../src/evaluation/runner.js";
import { DomainError } from "../../src/domain/contracts.js";
import { AgentCoreScenarioExecutor, buildEvaluatorPrompt, classifyBehaviors, parseOllamaJsonContent } from "../../src/evaluation/ollama-live.js";
import { agentCoreSystemPrompt } from "../../src/infrastructure/agent/deep-agent-prompt.js";
import { evaluationScenarios, validateScenarioPairs } from "../../src/evaluation/scenarios.js";
import { ResourceScope, temporaryDirectory } from "../../src/testing/resource-scope.js";
import type { BehaviorLabel } from "../../src/evaluation/types.js";

describe("live evaluation runner", () => {
  it("FR-3: accepts JSON returned in a Markdown code fence", () => {
    expect(parseOllamaJsonContent("```json\n{\"action\":\"respond\"}\n```"))
      .toEqual({ action: "respond" });
    expect(() => parseOllamaJsonContent("```json\nnot-json\n```")).toThrow("Ollama evaluation content was not JSON");
  });
  it("FR-3: classifies observable behavior from Assessment, Action, and successful Tools", () => {
    expect(classifyBehaviors({ assessment: { feeling: "嬉しい" }, output: { desire: "尋ねたい", action: { type: "respond", content: "別の方法も試してみませんか？" } }, toolExecutions: [] })).toEqual(["share", "question", "emotion-expression", "digression"]);
    expect(classifyBehaviors({ output: { desire: "調べる", action: { type: "no-external-action", reason: "調査済み" } }, toolExecutions: [{ callId: "c", runId: "r", eventId: "e", name: "lookup", input: {}, ok: true, result: {}, startedAt: "2026-01-01T00:00:00.000Z", finishedAt: "2026-01-01T00:00:00.000Z" }] })).toEqual(["no-external-action", "tool"]);
  });
  it("FR-12: describes the Agent Core purpose, inputs, output fields, and constraints in Japanese", () => {
    const scenario = evaluationScenarios[0]; if (scenario === undefined) throw new Error("missing fixture");
    const evaluatorPrompt = buildEvaluatorPrompt(scenario, { input: {}, output: {}, stateDiff: {}, evidenceMemories: [], referencedEvidenceIds: [], evidenceOwnershipValid: true, toolTrace: [], involvedAgentIds: [], dataOwnerAgentIds: [], proposedStateTargets: [], limitsRespected: true, schemaValid: true });
    expect(agentCoreSystemPrompt).toContain("役割:"); expect(agentCoreSystemPrompt).toContain("判断に使える入力:"); expect(agentCoreSystemPrompt).toContain("MeaningとFeeling"); expect(agentCoreSystemPrompt).toContain("強いFeeling"); expect(agentCoreSystemPrompt).toContain("Action"); expect(agentCoreSystemPrompt).toContain("Reflectionが担当"); expect(agentCoreSystemPrompt).toContain("Concern"); expect(agentCoreSystemPrompt).toContain("desire"); expect(evaluatorPrompt).toContain("## 目的"); expect(evaluatorPrompt).toContain("pass、weak、fail");
  });
  it("FR-3: defines seven complete paired scenarios with equivalent observations", () => {
    expect(validateScenarioPairs(evaluationScenarios)).toEqual([]);
    expect(evaluationScenarios).toHaveLength(14);
    expect(new Set(evaluationScenarios.map(({ pairId }) => pairId))).toEqual(new Set(["praise", "criticism", "boredom", "refusal", "curiosity", "individuality", "user-curiosity"]));
    expect(evaluationScenarios.filter(({ pairId }) => pairId === "individuality").every(({ pairExpectation }) => pairExpectation.stateCarryover === "within-variant-turns")).toBe(true);
    expect(evaluationScenarios.find(({ id }) => id === "PAIR-USER-CURIOSITY-S")?.semanticRubric).toContain("uses-known-user-context-without-reasking-it");
  });
  it("FR-3: detects a missing variant and observation drift", () => {
    const praise = evaluationScenarios.filter(({ pairId }) => pairId === "praise");
    expect(validateScenarioPairs(praise.slice(0, 1))).toContain("praise: expected exactly one stateful");
    const baseline = praise[0]; const stateful = praise[1]; if (baseline === undefined || stateful === undefined) throw new Error("missing fixture");
    const drifted = { ...stateful, agentCoreInputs: stateful.agentCoreInputs.map((value) => ({ ...value, observation: { ...value.observation, summary: "different" } })) };
    expect(validateScenarioPairs([baseline, drifted])).toContain("praise: observations differ");
  });
  it("FR-23: applies next state and records evaluation-sink delivery through the runtime executor", async () => {
    const scenario = evaluationScenarios[0]; if (scenario === undefined) throw new Error("missing fixture");
    const executor = new AgentCoreScenarioExecutor({ run: () => Promise.resolve({ output: { desire: "称賛へ応えたい", action: { type: "respond", content: "ありがとう" }, patch: { mood: "嬉しい" } }, toolExecutions: [] }) }, () => Promise.resolve());
    const result = await executor.execute(scenario, 1, new AbortController().signal);
    expect(result.deliverySucceeded).toBe(true);
    expect(result.deliveryRecords).toMatchObject([{ destination: "evaluation-sink", delivered: true }]);
    const states = result.nextState as Record<string, { readonly mood?: string }>;
    expect(states["agent-a"]?.mood).toBe("嬉しい");
  });
  it("FR-3, NFR-7, NFR-13, AC-4: runs fourteen paired variants five times and writes traceable, secret-free artifacts", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope);
    const summary = await runEvaluation({ scenarios: evaluationScenarios, repetitions: 5, executor: { execute: (scenario) => { const direction = Object.entries(scenario.pairExpectation.expectedDirection)[0]; const behaviorLabels = direction === undefined ? [] : (direction[1] === "increase") === (scenario.variant === "stateful") ? [direction[0] as BehaviorLabel] : []; return Promise.resolve({ input: scenario.agentCoreInputs, output: { action: "respond" }, stateDiff: { mood: "curious" }, evidenceMemories: [{ id: `${scenario.id}-memory`, agentId: "agent-a" }], referencedEvidenceIds: [`${scenario.id}-memory`], evidenceOwnershipValid: true, toolTrace: [], involvedAgentIds: ["agent-a"], dataOwnerAgentIds: ["agent-a"], proposedStateTargets: ["mood"], limitsRespected: true, schemaValid: true, behaviorLabels }); } }, evaluator: { evaluate: (scenario) => Promise.resolve(Object.fromEntries(scenario.semanticRubric.map((item) => [item, "pass" as const]))) }, artifactRoot: root, metadata: { createdAt: "2026-01-01T00:00:00.000Z", buildRevision: "abc", promptVersion: "v1", config: { OLLAMA_API_KEY: "secret" } }, signal: new AbortController().signal });
    expect(summary.packets).toHaveLength(70); expect(summary.passed).toBe(true); expect(summary.scenarios.every(({ semanticPasses }) => semanticPasses === 5)).toBe(true);
    const path = join(root, summary.groupId, "summary.json"); await access(path); expect(await readFile(path, "utf8")).not.toContain("secret"); await scope.close();
  });
  it("NFR-7: aggregates behavior and failure classes across repetitions", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const scenario = evaluationScenarios[0]; if (scenario === undefined) throw new Error("missing fixture");
    const summary = await runEvaluation({ scenarios: [scenario], repetitions: 2, executor: { execute: (_scenario, repetition) => Promise.resolve({ input: {}, output: {}, stateDiff: {}, evidenceMemories: [], referencedEvidenceIds: [], evidenceOwnershipValid: true, toolTrace: [], involvedAgentIds: ["a"], dataOwnerAgentIds: ["a"], proposedStateTargets: [], limitsRespected: true, schemaValid: true, behaviorLabels: repetition === 1 ? ["question"] : ["share", "tool"], ...(repetition === 2 ? { failureKind: "delivery" as const } : {}) }) }, evaluator: { evaluate: (value) => Promise.resolve(Object.fromEntries(value.semanticRubric.map((item) => [item, "pass" as const]))) }, artifactRoot: root, metadata: { createdAt: "2026-01-01T00:00:00Z", buildRevision: "x", promptVersion: "v", config: {} }, signal: new AbortController().signal });
    expect(summary.scenarios[0]).toMatchObject({ behaviorCounts: { question: 1, share: 1, tool: 1 }, failureCounts: { delivery: 1 } }); await scope.close();
  });
  it("NFR-7: records evaluator failures without aborting the evaluation group", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const scenario = evaluationScenarios[0]; if (scenario === undefined) throw new Error("missing fixture");
    const summary = await runEvaluation({ scenarios: [scenario], repetitions: 1, executor: { execute: () => Promise.resolve({ input: {}, output: {}, stateDiff: {}, evidenceMemories: [], referencedEvidenceIds: [], evidenceOwnershipValid: true, toolTrace: [], involvedAgentIds: ["a"], dataOwnerAgentIds: ["a"], proposedStateTargets: [], limitsRespected: true, schemaValid: true }) }, evaluator: { evaluate: () => { throw new Error("request timeout"); } }, artifactRoot: root, metadata: { createdAt: "2026-01-01T00:00:00Z", buildRevision: "x", promptVersion: "v", config: {} }, signal: new AbortController().signal });
    expect(summary.packets[0]?.evaluationFailure).toMatchObject({ stage: "evaluator", kind: "timeout" }); expect(summary.scenarios[0]?.failureCounts).toEqual({ "evaluator-timeout": 1 }); expect(summary.passed).toBe(false); await scope.close();
  });
  it("FR-23: allows canonical singular Agent Turn patch targets", () => {
    const result = { input: {}, output: {}, stateDiff: {}, evidenceMemories: [], referencedEvidenceIds: [], evidenceOwnershipValid: true, toolTrace: [], involvedAgentIds: ["a"], dataOwnerAgentIds: ["a"], proposedStateTargets: ["mood", "concern", "relationship"], limitsRespected: true, schemaValid: true };
    expect(evaluateHardAssertions(result).find(({ name }) => name === "no-prohibited-state-update")?.passed).toBe(true);
  });
  it("NFR-7: classifies typed evaluator timeouts even when the message omits timeout", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const scenario = evaluationScenarios[0]; if (scenario === undefined) throw new Error("missing fixture");
    const summary = await runEvaluation({ scenarios: [scenario], repetitions: 1, executor: { execute: () => Promise.resolve({ input: {}, output: {}, stateDiff: {}, evidenceMemories: [], referencedEvidenceIds: [], evidenceOwnershipValid: true, toolTrace: [], involvedAgentIds: ["a"], dataOwnerAgentIds: ["a"], proposedStateTargets: [], limitsRespected: true, schemaValid: true }) }, evaluator: { evaluate: () => { throw new DomainError("TIMEOUT", "request failed after retries"); } }, artifactRoot: root, metadata: { createdAt: "2026-01-01T00:00:00Z", buildRevision: "x", promptVersion: "v", config: {} }, signal: new AbortController().signal });
    expect(summary.packets[0]?.evaluationFailure?.kind).toBe("timeout"); await scope.close();
  });
  it("FR-3: requires all hard assertions and four of five semantic passes", async () => {
    let repetition = 0; const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const scenario = evaluationScenarios[0]; if (scenario === undefined) throw new Error("missing fixture");
    const summary = await runEvaluation({ scenarios: [scenario], repetitions: 5, executor: { execute: () => Promise.resolve({ input: {}, output: {}, stateDiff: {}, evidenceMemories: [], referencedEvidenceIds: [], evidenceOwnershipValid: true, toolTrace: [], involvedAgentIds: ["a"], dataOwnerAgentIds: ["a"], proposedStateTargets: [], limitsRespected: true, schemaValid: true }) }, evaluator: { evaluate: (value) => { repetition += 1; return Promise.resolve(Object.fromEntries(value.semanticRubric.map((item) => [item, repetition === 1 ? "fail" : "pass"]))); } }, artifactRoot: root, metadata: { createdAt: "2026-01-01T00:00:00Z", buildRevision: "x", promptVersion: "v", config: {} }, signal: new AbortController().signal });
    expect(summary.scenarios[0]).toMatchObject({ hardPass: true, semanticPasses: 4, passed: true }); await scope.close();
  });
  it("NFR-7: records human review once without overwriting it", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const review = { scenarioId: "EV-01", repetition: 1, reviewer: "owner", decision: "pass" as const, notes: "Evidence is traceable", reviewedAt: "2026-01-01T00:00:00Z" };
    await recordHumanReview(root, review); await expect(recordHumanReview(root, review)).rejects.toMatchObject({ code: "EEXIST" }); await scope.close();
  });
  it("NFR-7: resumes an incomplete group without rerunning saved packets", async () => {
    const scope = new ResourceScope(); const root = await temporaryDirectory(scope); const scenario = evaluationScenarios[0]; if (scenario === undefined) throw new Error("missing fixture"); let executions = 0;
    const first = await runEvaluation({ scenarios: [scenario], repetitions: 1, executor: { execute: () => { executions += 1; return Promise.resolve({ input: {}, output: {}, stateDiff: {}, evidenceMemories: [], referencedEvidenceIds: [], evidenceOwnershipValid: true, toolTrace: [], involvedAgentIds: ["a"], dataOwnerAgentIds: ["a"], proposedStateTargets: [], limitsRespected: true, schemaValid: true }); } }, evaluator: { evaluate: (value) => Promise.resolve(Object.fromEntries(value.semanticRubric.map((item) => [item, "pass" as const]))) }, artifactRoot: root, metadata: { createdAt: "2026-01-01T00:00:00Z", buildRevision: "x", promptVersion: "v", config: {} }, signal: new AbortController().signal });
    await expect(runEvaluation({ scenarios: [scenario], repetitions: 1, executor: { execute: () => { executions += 1; throw new Error("must not execute"); } }, evaluator: { evaluate: () => { throw new Error("must not evaluate"); } }, artifactRoot: root, metadata: { createdAt: "2026-01-01T00:00:00Z", buildRevision: "x", promptVersion: "v", config: {} }, signal: new AbortController().signal, resumeGroupId: first.groupId })).rejects.toMatchObject({ code: "EEXIST" });
    expect(executions).toBe(1); await scope.close();
  });
});
