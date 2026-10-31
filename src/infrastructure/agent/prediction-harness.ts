import { z } from "zod";

import type { PredictionModel, PredictionModelInput } from "../../application/prediction.js";
import { PredictionOutputSchema, type PredictionOutput } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";

export const predictionSystemPrompt = `あなたはAgentのG1/G2予測担当です。現在のユーザー発話とAgentの応答を観測し、次のユーザー発話を予測し、前回の予測を評価します。

入力:
- observation: 今回のユーザー発話の要点
- recentExperiences: 直近のAgent経験
- previousPrediction: 前回の予測と評価
- memoryCandidates: 参照可能なMemory/Background Experience

出力:
- predictions.g1: 語彙、文法、表記、口調、言い回しの候補。expectationはvery_high / high / medium / low / very_low
- predictions.g2: 意味、命題、会話行為の候補。speechActは質問、同意、拒否、保留、話題転換など。expectationは離散値
- predictionEvaluations: 候補ごとの評価。group、candidateIndex、match、surprise、difference、interpretation、uncertainty、attribution、observed、errorDirection、effect、effectEvidenceを分けて書く
- observationCandidates: 保存候補の観測事実。explicitnessはexplicit / inferred
- remember: MemoryIntent。content、reason、evidenceEventIds、confidence（high/medium/low）、target
- g3: needsG3、targetLayers（L4/L5/L6）、reason、priority（high/medium/low）

制約:
- Feeling、感情の最終判断、Meaningは出力しない。それらはMainAgentが決める
- 期待度を確率値や校正済みスコアにしない
- 前回の予測と評価を入力から参照し、候補ごとに評価する
- 現在のユーザーをBackground Experienceの登場人物にしない
- 入力にないID、事実、予測を作らない
- 構造化出力だけを返す`;

export function createOllamaPredictionModel(config: OllamaChatConfig, logger: Logger = noopLogger): PredictionModel {
  const model = createOllamaChatModel(config);
  const structured = model.withStructuredOutput(PredictionOutputSchema, { name: "g1_g2_prediction" });
  return {
    async predict(input: PredictionModelInput, signal: AbortSignal): Promise<PredictionOutput> {
      try {
        const output = await structured.invoke([
          { role: "system", content: predictionSystemPrompt },
          { role: "user", content: JSON.stringify(input) }
        ], { signal });
        return PredictionOutputSchema.parse(output);
      } catch (error) {
        logger.log("warn", "prediction.failed", { agentId: input.agentId, ...errorLogContext(error) });
        throw providerFailure("G1/G2 prediction", error, signal);
      }
    }
  };
}

export const predictionOutputJsonSchema = z.toJSONSchema(PredictionOutputSchema);
