import { z } from "zod";

import type { AgentHarness } from "../application/ports.js";
import { DomainError, type AgentCoreOutput, type ToolExecutionRecord } from "../domain/contracts.js";
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
    for (const input of scenario.agentCoreInputs) {
      await this.validateEmbedding(JSON.stringify({ scenarioId: scenario.id, repetition, input }), signal);
      const result = await this.harness.run(input, signal);
      outputs.push({ agentId: input.run.agentId, output: result.output, toolExecutions: result.toolExecutions });
    }
    const coreOutputs = outputs.map(({ output }) => output); const stateUpdates = coreOutputs.flatMap(({ internalChanges }) => internalChanges.transientStateUpdates);
    const referencedEvidenceIds = [...new Set([...stateUpdates.flatMap(({ evidenceIds }) => evidenceIds), ...coreOutputs.flatMap(({ internalChanges }) => internalChanges.longTermCandidates.flatMap(({ evidenceMemoryIds }) => evidenceMemoryIds))])];
    const toolTrace = outputs.flatMap(({ agentId, toolExecutions }) => toolExecutions.map((execution) => ({ agentId, ...execution })));
    const dataOwnerAgentIds = outputs.map(({ agentId }) => agentId); const owners = new Set(dataOwnerAgentIds);
    const outputOwnersValid = outputs.every(({ agentId }) => owners.has(agentId));
    const evidenceOwners = new Map(scenario.agentCoreInputs.flatMap((input) => [{ id: input.run.eventId, agentId: input.run.agentId }, ...input.memories.map(({ id, agentId }) => ({ id, agentId }))]).map((item) => [item.id, item.agentId]));
    const evidenceOwnershipValid = outputs.every(({ agentId, output }) => [...output.internalChanges.transientStateUpdates.flatMap(({ evidenceIds }) => evidenceIds), ...output.internalChanges.longTermCandidates.flatMap(({ evidenceMemoryIds }) => evidenceMemoryIds)].every((id) => evidenceOwners.get(id) === agentId));
    return { input: scenario.agentCoreInputs, output: outputs, stateDiff: outputs.map(({ agentId, output }) => ({ agentId, transientStateUpdates: output.internalChanges.transientStateUpdates, memoryProposals: output.internalChanges.memoryProposals, intentionProposals: output.internalChanges.intentionProposals, longTermCandidates: output.internalChanges.longTermCandidates })), evidenceMemories: scenario.evidenceMemories, referencedEvidenceIds, evidenceOwnershipValid, toolTrace, involvedAgentIds: scenario.involvedAgentIds, dataOwnerAgentIds, proposedStateTargets: stateUpdates.map(({ target }) => target), limitsRespected: outputOwnersValid && toolTrace.length <= scenario.maxToolCalls, schemaValid: true };
  }
}
export class OllamaEvaluator implements EvaluatorAdapter {
  constructor(private readonly config: { baseUrl: string; apiKey: string; model: string; timeoutMs?: number }) {}
  async evaluate(scenario: EvaluationScenario, result: ScenarioResult, signal: AbortSignal): Promise<Readonly<Record<string, "pass" | "weak" | "fail">>> {
    const raw = await chat(this.config.baseUrl, this.config.apiKey, this.config.model, buildEvaluatorPrompt(scenario, result), signal, this.config.timeoutMs ?? 300_000); const schema = z.record(z.string(), RubricRatingSchema); const ratings = schema.parse(raw);
    for (const item of scenario.semanticRubric) if (!(item in ratings)) throw new DomainError("VALIDATION", `Evaluator omitted rubric item: ${item}`); return ratings;
  }
}
