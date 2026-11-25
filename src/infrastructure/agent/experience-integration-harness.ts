import type { ExperienceIntegrationInput, ExperienceIntegrationModel } from "../../application/experience-integration.js";
import { EventExperienceSchema, ExperienceIntegrationOutputSchema } from "../../application/experience-integration.js";
import { PersistentMoodDescription } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { toModelRecordView } from "./model-record-view.js";

export const experienceIntegrationSystemPrompt = `あなたはExperience Integration担当です。すでにユーザーへの応答はcommit済みです。入力のEvent、Agent CoreのMeaning/Feeling/Desire/Action、Tool結果、既存Stateを見て、次回以降へ残す持続的な経験だけを判断します。

experienceは、今回実際に起きたこと・選択・確認済みの結果をsummaryとfactsで短く残し、必ず形成する。長期Memoryとして残すことがなくても、今回のEvent固有の経験は残す。定期Scheduleのreason、Meaning、Feeling、Desire、未確認の推測、Tool失敗だけはexperienceに書かない。
Memoryは最大3件。各Memoryはcontent、reason、target、perspectiveだけを持つ。根拠Event、subject、confidence、purpose、IDはRuntimeが今回のsource Eventから解決する。保存する経験がなければ必ず {"memories":[]} を返す。単発のTool失敗、単なる応答文、未確認の推測はMemoryにしない。
Relationshipは今回のactorとの持続的変化だけを出します。本文は現在の関係の型・安定した会話前提・未解決の約束だけとし、個別Event、人物プロフィール、Concern、Feeling、応答方針は入れません。Moodは${PersistentMoodDescription} 変化がなければ省略します。入力にfocusConcernがある時だけ、その本文と重要性を読んでfocusConcernを返せます。IDは見えず、出力もしません。核が満たされた時だけsatisfied、現在のSelfにとって価値を失ったことが明確な時だけabandonedです。検索失敗、情報不足、一時的なFeelingだけではabandonedにしません。変化がなければunchangedにします。入力にfocusConcernがなければ出しません。Memory、Relationship、Desireの代わりに出来事や計画を置かないでください。SelfとRuntimeが束縛していないConcernは扱いません。構造化出力だけを返してください。`;

const contentOf = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => { if (typeof part !== "object" || part === null || !("text" in part)) return ""; const text = (part as Record<string, unknown>).text; return typeof text === "string" ? text : ""; }).join("") : "";
const parseJson = (content: string): unknown => JSON.parse(content.trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, ""));
const recordView = (input: ExperienceIntegrationInput) => toModelRecordView({ event: { kind: input.sourceEvent.kind, occurredAt: input.sourceEvent.occurredAt, content: input.input.observation }, result: { assessment: input.result.assessment, output: input.result.output }, toolExecutions: input.result.toolExecutions.map(({ name, ok, result, error }) => ({ name, ok, ...(ok ? { result } : { error }) })) });

export type EventExperienceRepairModel = { integrate(input: ExperienceIntegrationInput, signal: AbortSignal): Promise<unknown> };
export function createOllamaEventExperienceRepairModel(config: OllamaChatConfig, logger: Logger = noopLogger): EventExperienceRepairModel {
  const model = createOllamaChatModel({ ...config, think: "low" }).withConfig({ format: modelJsonSchema(EventExperienceSchema) });
  return { async integrate(input, signal) {
    const startedAt = Date.now();
    try {
      const result = await model.invoke([{ role: "system", content: "完了済みEventのEvent Experienceだけを補完する。今回実際に起きたこと・選択・確認済み結果をsummaryとfactsで短く返す。Memory、Mood、Relationship、Self、Concernを判断・変更しない。定期起動理由、Meaning、Feeling、Desire、未確認の推測、Tool失敗だけを書かない。構造化出力だけを返す。" }, { role: "user", content: JSON.stringify(recordView(input)) }], { signal });
      const output = contentOf(result.content); if (output.trim().length === 0) throw new Error("Event Experience repair returned empty content");
      logger.log("info", "event_experience_repair.model_completed", { agentId: input.agentId, sourceRunId: input.sourceRunId, elapsedMs: Date.now() - startedAt, outputChars: output.length });
      return parseJson(output);
    } catch (error) { throw providerFailure("Event Experience repair", error, signal); }
  } };
}

export function createOllamaExperienceIntegrationModel(config: OllamaChatConfig, logger: Logger = noopLogger): ExperienceIntegrationModel {
  const model = createOllamaChatModel({ ...config, think: "low" }).withConfig({ format: modelJsonSchema(ExperienceIntegrationOutputSchema) });
  const modelInput = (input: ExperienceIntegrationInput) => toModelRecordView({ event: { kind: input.sourceEvent.kind, occurredAt: input.sourceEvent.occurredAt, content: input.input.observation }, input: { observation: input.input.observation, currentSelf: input.input.currentSelf, state: input.input.state, ...(input.focusConcern === undefined ? {} : { focusConcern: { description: input.focusConcern.description, whyItMatters: input.focusConcern.whyItMatters } }) }, result: { assessment: input.result.assessment, output: input.result.output }, toolExecutions: input.result.toolExecutions.map(({ name, ok, result, error }) => ({ name, ok, ...(ok ? { result } : { error }) })) });
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
    repair: (input, validationIssues, signal) => invoke(JSON.stringify({ instruction: "直前の出力はschema検証に失敗しました。新しい判断はせず、同じ入力事実だけで以下の検証エラーを直した完全な構造化出力を返してください。今回のEvent固有experienceは必須です。Memoryを保存しない場合は memories を空配列にしてください。", input: modelInput(input), validationIssues }), input, signal)
  };
}
