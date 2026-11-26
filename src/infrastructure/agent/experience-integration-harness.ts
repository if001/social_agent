import type { ExperienceIntegrationInput, ExperienceIntegrationModel } from "../../application/experience-integration.js";
import { EventExperienceSchema, ExperienceIntegrationOutputSchema } from "../../application/experience-integration.js";
import { PersistentMoodDescription } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { toModelRecordView } from "./model-record-view.js";
import type { ToolRegistry } from "../../application/tool-registry.js";
import { projectToolExecutionForModel } from "./tool-result-model-view.js";
import { parseModelJson, retryMalformedModelJson } from "./model-json-parser.js";

export const experienceIntegrationSystemPrompt = `あなたはExperience Integration担当です。応答は既にcommit済みであり、次のActionは選ばない。今回の確定Event、Core結果、投影済みTool結果から、将来へ残す持続的な経験だけを構造化出力する。

experienceは必ず形成する。今回の確定した出来事・選択・結果だけをsummaryとfactsで短く残す。許可fieldはsummaryとfactsだけで、occurredAt、kind、eventId、時刻、source、Meaning、Feeling、Desire、起動理由、未確認推測、Tool失敗は書かない。
Memoryは必要な時だけ最大3件。各要素はcontent、reason、target、perspectiveだけ。contentは要点、reasonは保存理由を短く書く。根拠Event、subject、confidence、purpose、ID、Tool本文、応答文、未確認推測は書かない。変化がなければ省略します。不要なら {"memories":[]}。
Relationshipは今回のactorとの持続的変化だけ。許可fieldはoperation、currentDescription、description、reasonだけで、operationはupsert または remove、reason は必須。currentDescriptionとdescriptionは各一文・240文字以内で、本文は現在の関係の型だけを表す。target、subjectId、agentId、相手名、ID、個別Event、人物プロフィール、Concern、Feeling、応答方針は書かない。変化がなければrelationship全体を省略します。Moodは${PersistentMoodDescription}だけを必要時に出す。
focusConcernは入力にある一件だけにoutcomeとreasonで答える。IDは見えず出力しない。核が満たされた時だけsatisfied、価値を明確に失った時だけabandoned、検索失敗・情報不足・一時的Feelingならunchanged。rootのconcernStatusは返さない。構造化出力だけを返す。`;
export const experienceIntegrationRepairInstruction = "直前の出力を、同じ入力事実だけでschemaに直す。experienceは必須でsummaryとfactsだけ。occurredAt、kind、eventId、時刻、sourceは削除する。Memoryを残さないならmemoriesは空配列。Relationshipはoperation、currentDescription、description、reasonだけで、operationはupsert又はremove、reasonは必須。currentDescriptionとdescriptionは各一文・240文字以内にし、関係の変化を短く言えないならrelationship全体を省略する。target、subjectId、agentId、相手名、IDは削除する。rootのconcernStatusは返さず、focusConcernはRuntimeが束縛した一件だけを判断する。JSON objectだけを返し、文字列値の改行は\\nとしてescapeする。";

const contentOf = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => { if (typeof part !== "object" || part === null || !("text" in part)) return ""; const text = (part as Record<string, unknown>).text; return typeof text === "string" ? text : ""; }).join("") : "";
type ExperienceIntegrationHarnessConfig = OllamaChatConfig & { readonly toolRegistry?: ToolRegistry };
export const eventExperienceRepairInput = (input: ExperienceIntegrationInput, tools?: ToolRegistry) => toModelRecordView({ event: { kind: input.sourceEvent.kind, occurredAt: input.sourceEvent.occurredAt, content: input.input.observation }, result: { assessment: input.result.assessment, output: input.result.output }, toolExecutions: input.result.toolExecutions.map((execution) => projectToolExecutionForModel(execution, tools)) });

export type EventExperienceRepairModel = { integrate(input: ExperienceIntegrationInput, signal: AbortSignal): Promise<unknown> };
export function createOllamaEventExperienceRepairModel({ toolRegistry, ...config }: ExperienceIntegrationHarnessConfig, logger: Logger = noopLogger): EventExperienceRepairModel {
  const model = createOllamaChatModel({ ...config, think: "low" }).withConfig({ format: modelJsonSchema(EventExperienceSchema) });
  return { async integrate(input, signal) {
    const startedAt = Date.now();
    try {
      const result = await model.invoke([{ role: "system", content: "完了済みEventのEvent Experienceだけを補完する。今回実際に起きたこと・選択・確認済み結果をsummaryとfactsで短く返す。Memory、Mood、Relationship、Self、Concernを判断・変更しない。定期起動理由、Meaning、Feeling、Desire、未確認の推測、Tool失敗だけを書かない。構造化出力だけを返す。" }, { role: "user", content: JSON.stringify(eventExperienceRepairInput(input, toolRegistry)) }], { signal });
      const output = contentOf(result.content); if (output.trim().length === 0) throw new Error("Event Experience repair returned empty content");
      logger.log("info", "event_experience_repair.model_completed", { agentId: input.agentId, sourceRunId: input.sourceRunId, elapsedMs: Date.now() - startedAt, outputChars: output.length });
      return parseModelJson(output);
    } catch (error) { throw providerFailure("Event Experience repair", error, signal); }
  } };
}

export function createOllamaExperienceIntegrationModel({ toolRegistry, ...config }: ExperienceIntegrationHarnessConfig, logger: Logger = noopLogger): ExperienceIntegrationModel {
  const model = createOllamaChatModel({ ...config, think: "low" }).withConfig({ format: modelJsonSchema(ExperienceIntegrationOutputSchema) });
  const modelInput = (input: ExperienceIntegrationInput) => experienceIntegrationModelInput(input, toolRegistry);
  const payload = (input: ExperienceIntegrationInput) => JSON.stringify(modelInput(input));
  const invoke = async (content: string, input: ExperienceIntegrationInput, signal: AbortSignal): Promise<unknown> => {
    const startedAt = Date.now();
    try {
      const result = await model.invoke([{ role: "system", content: experienceIntegrationSystemPrompt }, { role: "user", content }], { signal });
      const output = contentOf(result.content);
      if (output.trim().length === 0) throw new Error("Experience Integration returned empty content");
      logger.log("info", "experience_integration.model_completed", { agentId: input.agentId, sourceRunId: input.sourceRunId, elapsedMs: Date.now() - startedAt, inputChars: content.length, outputChars: output.length });
      return parseModelJson(output);
    } catch (error) {
      const failure = providerFailure("Experience Integration", error, signal);
      logger.log("warn", "experience_integration.failed", { agentId: input.agentId, sourceRunId: input.sourceRunId, ...errorLogContext(failure) });
      throw failure;
    }
  };
  return {
    integrate: (input, signal) => retryMalformedModelJson(
      () => invoke(payload(input), input, signal),
      () => invoke(JSON.stringify({ instruction: `${experienceIntegrationRepairInstruction} 前回の出力はJSON構文として読めなかったため、必ず有効なJSON objectだけを再生成する。`, input: modelInput(input) }), input, signal)
    ),
    repair: (input, validationIssues, signal) => invoke(JSON.stringify({ instruction: experienceIntegrationRepairInstruction, input: modelInput(input), validationIssues }), input, signal)
  };
}

export const experienceIntegrationModelInput = (input: ExperienceIntegrationInput, tools?: ToolRegistry) => toModelRecordView({ event: { kind: input.sourceEvent.kind, occurredAt: input.sourceEvent.occurredAt, content: input.input.observation }, input: { observation: input.input.observation, currentSelf: input.input.currentSelf, state: input.input.state, ...(input.focusConcern === undefined ? {} : { focusConcern: { description: input.focusConcern.description, whyItMatters: input.focusConcern.whyItMatters } }) }, result: { assessment: input.result.assessment, output: input.result.output }, toolExecutions: input.result.toolExecutions.map((execution) => projectToolExecutionForModel(execution, tools)) });
