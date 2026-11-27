import type { PredictionModel, PredictionModelInput } from "../../application/prediction.js";
import { PredictionOutputSchema, type PredictionOutput } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { toModelRecordView } from "./model-record-view.js";
import { parseModelJson } from "./model-json-parser.js";

export const predictionSystemPrompt = `あなたはAgentのG1/G2予測担当です。同じ相手との今回のdirect発話を観測し、次の発話を予測し、前回の予測と前回のAgent応答を評価します。

入力:
- observation: 今回のユーザー発話の要点
- previousPrediction: 同じ相手への前回の予測と評価
- previousAction: その予測を作ったturnでAgentが実際に返したAction。今回の発話が前回応答にどう反応したかを読む材料であり、今回のActionではない
- memoryCandidates: 参照可能なMemory/Background Experience

出力:
- predictions: { g1: { candidates: [...] }, g2: { candidates: [...] } } のobject。g1/g2を配列にしない
- predictions.g1.candidates: 表層の予測候補。最大1件
- predictions.g2.candidates: 意味・会話行為の予測候補。最大1件
- predictionEvaluations: 前回予測の評価。group、match、surprise、interpretationだけを返す
- investigation: 追加調査が必要な時だけ { reason } を返す

制約:
- Feeling、感情の最終判断、Meaningは出力しない。それらはMainAgentが決める
- expectationはvery_high / high / medium / low / very_lowのいずれか。文章を入れない
- 各layerの候補は最大1件。前回の予測と前回Actionを入力から参照して評価する
- 現在のユーザーをBackground Experienceの登場人物にしない
- 入力にないID、事実、予測を作らない
- JSON objectだけを返す`;

const expectation = (value: unknown): "very_high" | "high" | "medium" | "low" | "very_low" => {
  if (typeof value !== "string") return "medium";
  const normalized = value.trim().toLowerCase();
  if (["very_high", "very high", "veryhigh"].includes(normalized)) return "very_high";
  if (["very_low", "very low", "verylow"].includes(normalized)) return "very_low";
  if (["high", "高い"].includes(normalized)) return "high";
  if (["low", "低い"].includes(normalized)) return "low";
  if (["medium", "中程度", "普通"].includes(normalized)) return "medium";
  if (normalized.includes("very") && normalized.includes("high")) return "very_high";
  if (normalized.includes("very") && normalized.includes("low")) return "very_low";
  if (normalized.includes("high") || normalized.includes("高")) return "high";
  if (normalized.includes("low") || normalized.includes("低")) return "low";
  return "medium";
};
const text = (value: unknown, fallback: string): string => typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
const objectOf = (value: unknown): Record<string, unknown> => typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
const candidateArray = (value: unknown): unknown[] => Array.isArray(value) ? value : Array.isArray(objectOf(value).candidates) ? objectOf(value).candidates as unknown[] : [];

function normalizePrediction(raw: unknown): PredictionOutput {
  const root = objectOf(raw);
  const predictions = objectOf(root.predictions);
  const g1 = candidateArray(predictions.g1).slice(0, 1).map((item) => {
    const value = objectOf(item);
    return { feature: text(value.feature ?? value.aspect, "語彙・言い回し"), content: text(value.content ?? value.description, "次の発話を予測できなかった"), expectation: expectation(value.expectation), contextSummary: text(value.contextSummary ?? value.context, "現在の話題"), rationale: text(value.rationale ?? value.description, "入力から判断した") };
  });
  const g2 = candidateArray(predictions.g2).slice(0, 1).map((item) => {
    const value = objectOf(item);
    return { speechAct: text(value.speechAct ?? value.speech_act ?? value.aspect, "不明"), content: text(value.content ?? value.proposition ?? value.description, "次の発話を予測できなかった"), expectation: expectation(value.expectation), contextSummary: text(value.contextSummary ?? value.context, "現在の話題"), rationale: text(value.rationale ?? value.description, "入力から判断した") };
  });
  const predictionEvaluations = (Array.isArray(root.predictionEvaluations) ? root.predictionEvaluations : []).slice(0, 2).flatMap((item) => {
    const value = objectOf(item);
    if (value.group !== "g1" && value.group !== "g2") return [];
    return [{ group: value.group, match: ["primary", "alternative", "unexpected", "undecidable"].includes(String(value.match)) ? value.match as "primary" | "alternative" | "unexpected" | "undecidable" : "undecidable", surprise: ["none", "low", "medium", "high", "unknown"].includes(String(value.surprise)) ? value.surprise as "none" | "low" | "medium" | "high" | "unknown" : "unknown", interpretation: text(value.interpretation, "解釈を保留した") }];
  });
  const investigation = objectOf(root.investigation);
  return PredictionOutputSchema.parse({ predictions: { g1: { candidates: g1 }, g2: { candidates: g2 } }, predictionEvaluations, ...(typeof investigation.reason === "string" && investigation.reason.trim().length > 0 ? { investigation: { reason: investigation.reason.trim() } } : {}) });
}

const contentOf = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((item: unknown) => { const part = objectOf(item); return typeof part.text === "string" ? part.text : ""; }).join("");
  return "";
};

export function createOllamaPredictionModel(config: OllamaChatConfig, logger: Logger = noopLogger): PredictionModel {
  const model = createOllamaChatModel({ ...config, think: "low" });
  const jsonSchema = modelJsonSchema(PredictionOutputSchema);
  const structured = model.withConfig({ format: jsonSchema });
  return {
    async predict(input: PredictionModelInput, signal: AbortSignal): Promise<PredictionOutput> {
      const startedAt = Date.now();
      try {
        const inputJson = JSON.stringify(toModelRecordView(input));
        const result = await structured.invoke([
          { role: "system", content: predictionSystemPrompt },
          { role: "user", content: inputJson }
        ], { signal });
        const content = contentOf(result.content);
        const usage = objectOf(result.usage_metadata); const responseMeta = objectOf(result.response_metadata);
        logger.log("info", "prediction.model_completed", { elapsedMs: Date.now() - startedAt, systemPromptChars: predictionSystemPrompt.length, inputChars: inputJson.length, outputChars: content.length, ...(typeof usage.input_tokens === "number" ? { inputTokens: usage.input_tokens } : {}), ...(typeof usage.output_tokens === "number" ? { outputTokens: usage.output_tokens } : {}), ...(typeof responseMeta.finish_reason === "string" ? { finishReason: responseMeta.finish_reason } : {}) });
        if (content.trim().length === 0) throw providerFailure("G1/G2 prediction", new Error("Prediction returned empty content"), signal);
        return normalizePrediction(parseModelJson(content));
      } catch (error) {
        const failure = providerFailure("G1/G2 prediction", error, signal);
        logger.log("warn", "prediction.failed", { ...errorLogContext(failure), aborted: signal.aborted });
        throw failure;
      }
    }
  };
}
