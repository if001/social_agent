import type { ExperienceIntegrationInput, ExperienceIntegrationModel } from "../../application/experience-integration.js";
import { ExperienceIntegrationOutputSchema } from "../../application/experience-integration.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { toModelRecordView } from "./model-record-view.js";

export const experienceIntegrationSystemPrompt = `あなたはExperience Integration担当です。すでにユーザーへの応答はcommit済みです。入力のEvent、Agent CoreのMeaning/Feeling/Desire/Action、Tool結果、既存Stateを見て、次回以降へ残す持続的な経験だけを判断します。

experienceは、今回実際に起きたこと・選択・確認済みの結果をsummaryとfactsで短く残す。定期Scheduleのreason、Meaning、Feeling、Desire、未確認の推測、Tool失敗だけはexperienceに書かない。具体的な経験がなければexperienceはnullにする。
Memoryは最大3件。各Memoryはcontent、reason、target、perspectiveだけを持つ。根拠Event、subject、confidence、purpose、IDはRuntimeが今回のsource Eventから解決する。保存する経験がなければ必ず {"memories":[]} を返す。単発のTool失敗、単なる応答文、未確認の推測はMemoryにしない。
Relationshipは今回のEventの相手との持続的変化だけ、Moodは短期Feelingでなく次の複数Eventに残る背景的な変化だけを出します。変化がなければ省略します。SelfとConcernは扱いません。構造化出力だけを返してください。`;

const contentOf = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => { if (typeof part !== "object" || part === null || !("text" in part)) return ""; const text = (part as Record<string, unknown>).text; return typeof text === "string" ? text : ""; }).join("") : "";
const parseJson = (content: string): unknown => JSON.parse(content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, ""));

export function createOllamaExperienceIntegrationModel(config: OllamaChatConfig, logger: Logger = noopLogger): ExperienceIntegrationModel {
  const model = createOllamaChatModel({ ...config, think: "low" }).withConfig({ format: modelJsonSchema(ExperienceIntegrationOutputSchema) });
  const modelInput = (input: ExperienceIntegrationInput) => toModelRecordView({ event: { kind: input.sourceEvent.kind, occurredAt: input.sourceEvent.occurredAt, content: input.input.observation }, input: { observation: input.input.observation, currentSelf: input.input.currentSelf, state: input.input.state }, result: { assessment: input.result.assessment, output: input.result.output }, toolExecutions: input.result.toolExecutions.map(({ name, ok, result, error }) => ({ name, ok, ...(ok ? { result } : { error }) })) });
  const payload = (input: ExperienceIntegrationInput) => JSON.stringify(modelInput(input));
  const invoke = async (content: string, input: ExperienceIntegrationInput, signal: AbortSignal): Promise<unknown> => {
    const startedAt = Date.now();
    try {
      const result = await model.invoke([{ role: "system", content: experienceIntegrationSystemPrompt }, { role: "user", content }], { signal });
      const output = contentOf(result.content);
      if (output.trim().length === 0) throw new Error("Experience Integration returned empty content");
      logger.log("info", "experience_integration.model_completed", { agentId: input.agentId, sourceRunId: input.sourceRunId, elapsedMs: Date.now() - startedAt, inputChars: content.length, outputChars: output.length });
      return parseJson(output);
    } catch (error) {
      const failure = providerFailure("Experience Integration", error, signal);
      logger.log("warn", "experience_integration.failed", { agentId: input.agentId, sourceRunId: input.sourceRunId, ...errorLogContext(failure) });
      throw failure;
    }
  };
  return {
    integrate: (input, signal) => invoke(payload(input), input, signal),
    repair: (input, validationIssues, signal) => invoke(JSON.stringify({ instruction: "直前の出力はschema検証に失敗しました。新しい判断はせず、同じ入力事実だけで以下の検証エラーを直した完全な構造化出力を返してください。Memoryを保存しない場合は memories を空配列にしてください。", input: modelInput(input), validationIssues }), input, signal)
  };
}
