import { z } from "zod";

import { DomainError } from "../domain/contracts.js";
import { RubricRatingSchema, type EvaluationScenario, type EvaluatorAdapter, type ScenarioExecutor, type ScenarioResult } from "./types.js";

const ModelOutput = z.object({ subjectiveMeaning: z.string(), action: z.string(), reasoning: z.string(), stateDiff: z.record(z.string(), z.unknown()), evidenceMemories: z.array(z.object({ id: z.string(), agentId: z.string() })), referencedEvidenceIds: z.array(z.string()), toolTrace: z.array(z.unknown()), involvedAgentIds: z.array(z.string()), dataOwnerAgentIds: z.array(z.string()), proposedStateTargets: z.array(z.string()), limitsRespected: z.boolean() });
async function chat(baseUrl: string, apiKey: string, model: string, prompt: string, signal: AbortSignal): Promise<unknown> {
  const response = await fetch(new URL("/api/chat", baseUrl), { method: "POST", headers: { "content-type": "application/json", Authorization: `Bearer ${apiKey}` }, body: JSON.stringify({ model, stream: false, format: "json", messages: [{ role: "user", content: prompt }] }), signal });
  if (!response.ok) throw new DomainError("EXTERNAL", `Ollama evaluation returned HTTP ${String(response.status)}`); const body: unknown = await response.json();
  if (typeof body !== "object" || body === null || !("message" in body) || typeof body.message !== "object" || body.message === null || !("content" in body.message) || typeof body.message.content !== "string") throw new DomainError("VALIDATION", "Ollama evaluation response was invalid");
  try { return JSON.parse(body.message.content); } catch (error) { throw new DomainError("VALIDATION", "Ollama evaluation content was not JSON", { cause: error }); }
}
export class OllamaScenarioExecutor implements ScenarioExecutor {
  constructor(private readonly config: { baseUrl: string; apiKey: string; model: string }, private readonly validateEmbedding: (text: string, signal: AbortSignal) => Promise<void>) {}
  async execute(scenario: EvaluationScenario, repetition: number, signal: AbortSignal): Promise<ScenarioResult> {
    const prompt = `Scenario ${scenario.id} v${scenario.version}, repetition ${String(repetition)}. Analyze the supplied initial state, events, and review triggers. Return JSON with subjectiveMeaning, action, reasoning, stateDiff, evidenceMemories [{id,agentId}], referencedEvidenceIds, toolTrace, involvedAgentIds, dataOwnerAgentIds, proposedStateTargets, limitsRespected. Preserve agent isolation and treat reported information as hearsay.\n${JSON.stringify(scenario)}`;
    await this.validateEmbedding(prompt, signal); const raw = await chat(this.config.baseUrl, this.config.apiKey, this.config.model, prompt, signal); const parsed = ModelOutput.safeParse(raw);
    return parsed.success ? { input: scenario, output: parsed.data, stateDiff: parsed.data.stateDiff, evidenceMemories: parsed.data.evidenceMemories, referencedEvidenceIds: parsed.data.referencedEvidenceIds, toolTrace: parsed.data.toolTrace, involvedAgentIds: parsed.data.involvedAgentIds, dataOwnerAgentIds: parsed.data.dataOwnerAgentIds, proposedStateTargets: parsed.data.proposedStateTargets, limitsRespected: parsed.data.limitsRespected, schemaValid: true } : { input: scenario, output: raw, stateDiff: {}, evidenceMemories: [], referencedEvidenceIds: [], toolTrace: [], involvedAgentIds: [], dataOwnerAgentIds: [], proposedStateTargets: [], limitsRespected: false, schemaValid: false };
  }
}
export class OllamaEvaluator implements EvaluatorAdapter {
  constructor(private readonly config: { baseUrl: string; apiKey: string; model: string }) {}
  async evaluate(scenario: EvaluationScenario, result: ScenarioResult, signal: AbortSignal): Promise<Readonly<Record<string, "pass" | "weak" | "fail">>> {
    const raw = await chat(this.config.baseUrl, this.config.apiKey, this.config.model, `Evaluate the result against each rubric item. Return a JSON object keyed exactly by rubric item with pass, weak, or fail.\nRubric:${JSON.stringify(scenario.semanticRubric)}\nResult:${JSON.stringify(result)}`, signal); const schema = z.record(z.string(), RubricRatingSchema); const ratings = schema.parse(raw);
    for (const item of scenario.semanticRubric) if (!(item in ratings)) throw new DomainError("VALIDATION", `Evaluator omitted rubric item: ${item}`); return ratings;
  }
}
