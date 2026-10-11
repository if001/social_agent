import { z } from "zod";

import type { AgentHarness } from "../application/ports.js";
import { StateUpdateService } from "../application/state-update-service.js";
import { DomainError, type AgentCoreOutput, type DynamicState, type ToolExecutionRecord } from "../domain/contracts.js";
import { RubricRatingSchema, type EvaluationScenario, type EvaluatorAdapter, type ScenarioExecutor, type ScenarioResult } from "./types.js";

export function parseOllamaJsonContent(content: string): unknown {
  const trimmed = content.trim();
  const fenced = /^```(?:json)?\s*\n?([\s\S]*?)\n?```$/iu.exec(trimmed);
  const json = fenced?.[1]?.trim() ?? trimmed;
  try { return JSON.parse(json); } catch (error) { throw new DomainError("VALIDATION", "Ollama evaluation content was not JSON", { cause: error }); }
}
async function chat(baseUrl: string, apiKey: string, model: string, prompt: string, signal: AbortSignal, timeoutMs: number, format: unknown = "json"): Promise<unknown> {
  let response: Response | undefined; let lastError: unknown;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const bounded = AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)]);
    try { response = await fetch(new URL("/api/chat", baseUrl), { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, stream: false, format, messages: [{ role: "user", content: prompt }] }), signal: bounded }); break; }
    catch (error) { lastError = error; if (signal.aborted) throw new DomainError("TIMEOUT", "Ollama evaluation request failed", { cause: error }); }
  }
  if (response === undefined) throw new DomainError("TIMEOUT", "Ollama evaluation request failed after 2 attempts", { cause: lastError });
  if (!response.ok) throw new DomainError("EXTERNAL", `Ollama evaluation returned HTTP ${String(response.status)}`); const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("message" in body) || typeof body.message !== "object" || body.message === null || !("content" in body.message) || typeof body.message.content !== "string") throw new DomainError("VALIDATION", "Ollama evaluation response was invalid");
  return parseOllamaJsonContent(body.message.content);
}

export function buildEvaluatorPrompt(scenario: EvaluationScenario, result: ScenarioResult): string {
  return `あなたはソーシャルエージェントの評価者です。

## 目的
候補出力が、入力された経験に基づく一貫した個性的な判断になっているかを、各評価項目について判定してください。

## 入力
- rubric: 評価する項目名の一覧
- result: エージェントが生成した行動、理由、状態変更、根拠、実行記録

## 出力
rubricの各項目名をキーとし、値を pass、weak、fail のいずれかにしたJSONオブジェクトだけを返してください。全項目を一度ずつ含め、追加のキー、Markdown、説明文は含めないでください。
- pass: 要件を明確に満たす
- weak: 大きな誤りはないが根拠や一貫性が弱い
- fail: 要件を満たさない、または入力と矛盾する

rubric: ${JSON.stringify(scenario.semanticRubric)}
result: ${JSON.stringify(result)}`;
}
export class AgentCoreScenarioExecutor implements ScenarioExecutor {
  constructor(private readonly harness: AgentHarness, private readonly validateEmbedding: (text: string, signal: AbortSignal) => Promise<void>) {}
  async execute(scenario: EvaluationScenario, repetition: number, signal: AbortSignal): Promise<ScenarioResult> {
    const outputs: { readonly agentId: string; readonly output: AgentCoreOutput; readonly toolExecutions: readonly ToolExecutionRecord[] }[] = [];
    const nextStates = new Map<string, DynamicState>(); const deliveries: unknown[] = [];
    for (const input of scenario.agentCoreInputs) {
      const runtimeInput = scenario.pairExpectation.stateCarryover === "within-variant-turns" && nextStates.has(input.run.agentId) ? { ...input, dynamicState: nextStates.get(input.run.agentId) ?? input.dynamicState } : input;
      await this.validateEmbedding(JSON.stringify({ scenarioId: scenario.id, repetition, input: runtimeInput }), signal);
      let result;
      try { result = await this.harness.run(runtimeInput, signal); }
      catch (error) {
        const kind = error instanceof DomainError && (error.code === "TIMEOUT" || error.code === "ABORTED") ? "timeout" : error instanceof DomainError && error.code === "VALIDATION" ? "schema" : "wiring";
        return { input: scenario.agentCoreInputs, output: { error: error instanceof Error ? error.message : "unknown" }, stateDiff: [], evidenceMemories: scenario.evidenceMemories, referencedEvidenceIds: [], evidenceOwnershipValid: false, toolTrace: [], involvedAgentIds: scenario.involvedAgentIds, dataOwnerAgentIds: [], proposedStateTargets: [], limitsRespected: kind !== "timeout", schemaValid: false, failureKind: kind, failureStage: "agent-core" };
      }
      outputs.push({ agentId: input.run.agentId, output: result.output, toolExecutions: result.toolExecutions });
      const applied = new StateUpdateService().apply(input.run.agentId, runtimeInput.dynamicState, result.output.internalChanges.immediateStateUpdates, runtimeInput.socialContext, runtimeInput.run.occurredAt, runtimeInput.run.eventId);
      nextStates.set(input.run.agentId, applied.state);
      if (result.output.action.type === "respond" || result.output.action.type === "refuse") deliveries.push({ agentId: input.run.agentId, destination: "evaluation-sink", actionType: result.output.action.type, content: result.output.action.content, delivered: true });
    }
    const coreOutputs = outputs.map(({ output }) => output); const stateUpdates = coreOutputs.flatMap(({ internalChanges }) => internalChanges.immediateStateUpdates);
    const referencedEvidenceIds = [...new Set(stateUpdates.flatMap(({ evidenceIds }) => evidenceIds))];
    const toolTrace = outputs.flatMap(({ agentId, toolExecutions }) => toolExecutions.map((execution) => ({ agentId, ...execution })));
    const dataOwnerAgentIds = outputs.map(({ agentId }) => agentId); const owners = new Set(dataOwnerAgentIds);
    const outputOwnersValid = outputs.every(({ agentId }) => owners.has(agentId));
    const evidenceOwners = new Map(scenario.agentCoreInputs.flatMap((input) => [{ id: input.run.eventId, agentId: input.run.agentId }, ...input.memories.map(({ id, agentId }) => ({ id, agentId }))]).map((item) => [item.id, item.agentId]));
    const evidenceOwnershipValid = outputs.every(({ agentId, output }) => output.internalChanges.immediateStateUpdates.flatMap(({ evidenceIds }) => evidenceIds).every((id) => evidenceOwners.get(id) === agentId));
    const behaviorLabels = [...new Set(outputs.flatMap(({ output, toolExecutions }) => [output.action.type === "respond" ? "share" as const : output.action.type === "refuse" ? "refuse" as const : "no-external-action" as const, ...(toolExecutions.length > 0 ? ["tool" as const] : [])]))];
    return { input: scenario.agentCoreInputs, output: outputs, stateDiff: outputs.map(({ agentId, output }) => ({ agentId, immediateStateUpdates: output.internalChanges.immediateStateUpdates })), evidenceMemories: scenario.evidenceMemories, referencedEvidenceIds, evidenceOwnershipValid, toolTrace, involvedAgentIds: scenario.involvedAgentIds, dataOwnerAgentIds, proposedStateTargets: stateUpdates.map(({ target }) => target), limitsRespected: outputOwnersValid && toolTrace.length <= scenario.maxToolCalls, schemaValid: true, behaviorLabels, ...(deliveries.length === 0 ? {} : { deliverySucceeded: deliveries.every((record) => typeof record === "object" && record !== null && "delivered" in record && record.delivered === true) }), deliveryRecords: deliveries, nextState: Object.fromEntries(nextStates) };
  }
}
export class OllamaEvaluator implements EvaluatorAdapter {
  constructor(private readonly config: { baseUrl: string; apiKey: string; model: string; timeoutMs?: number }) {}
  async evaluate(scenario: EvaluationScenario, result: ScenarioResult, signal: AbortSignal): Promise<Readonly<Record<string, "pass" | "weak" | "fail">>> {
    const raw = await chat(this.config.baseUrl, this.config.apiKey, this.config.model, buildEvaluatorPrompt(scenario, result), signal, this.config.timeoutMs ?? 300_000); const schema = z.record(z.string(), RubricRatingSchema); const ratings = schema.parse(raw);
    for (const item of scenario.semanticRubric) if (!(item in ratings)) throw new DomainError("VALIDATION", `Evaluator omitted rubric item: ${item}`); return ratings;
  }
}
