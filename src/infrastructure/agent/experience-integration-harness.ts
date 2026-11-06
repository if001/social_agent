import type { ExperienceIntegrationInput, ExperienceIntegrationModel, ExperienceIntegrationOutput } from "../../application/experience-integration.js";
import { ExperienceIntegrationOutputSchema } from "../../application/experience-integration.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";

export const experienceIntegrationSystemPrompt = `あなたはExperience Integration担当です。すでにユーザーへの応答はcommit済みです。入力のEvent、Agent CoreのMeaning/Feeling/Desire/Action、Tool結果、既存Stateを見て、次回以降へ残す持続的な経験だけを判断します。

Memoryは最大3件。ユーザーについて確認できた事実は perspective=user, purpose=user-context とし、Agent自身の探索・行動・判断から得た経験は perspective=self, purpose=self-guidance とします。単発のTool失敗、単なる応答文、未確認の推測はMemoryにしません。
Relationshipは今回のEventの相手との持続的変化だけ、Moodは短期Feelingでなく次の複数Eventに残る背景的な変化だけを出します。変化がなければ省略または空配列にします。SelfとConcernは扱いません。構造化出力だけを返してください。`;

const contentOf = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => { if (typeof part !== "object" || part === null || !("text" in part)) return ""; const text = (part as Record<string, unknown>).text; return typeof text === "string" ? text : ""; }).join("") : "";
const parseJson = (content: string): unknown => JSON.parse(content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, ""));

export function createOllamaExperienceIntegrationModel(config: OllamaChatConfig, logger: Logger = noopLogger): ExperienceIntegrationModel {
  const model = createOllamaChatModel({ ...config, think: "low" }).withConfig({ format: modelJsonSchema(ExperienceIntegrationOutputSchema) });
  return { async integrate(input: ExperienceIntegrationInput, signal: AbortSignal): Promise<ExperienceIntegrationOutput> {
    const startedAt = Date.now(); const payload = JSON.stringify({ event: input.sourceEvent, input: input.input, result: { assessment: input.result.assessment, output: input.result.output }, toolExecutions: input.result.toolExecutions });
    try {
      const result = await model.invoke([{ role: "system", content: experienceIntegrationSystemPrompt }, { role: "user", content: payload }], { signal });
      const content = contentOf(result.content);
      if (content.trim().length === 0) throw new Error("Experience Integration returned empty content");
      const output = ExperienceIntegrationOutputSchema.parse(parseJson(content));
      logger.log("info", "experience_integration.completed", { agentId: input.agentId, sourceRunId: input.sourceRunId, elapsedMs: Date.now() - startedAt, inputChars: payload.length, outputChars: content.length });
      return output;
    } catch (error) {
      const failure = providerFailure("Experience Integration", error, signal);
      logger.log("warn", "experience_integration.failed", { agentId: input.agentId, sourceRunId: input.sourceRunId, ...errorLogContext(failure) });
      throw failure;
    }
  } };
}
