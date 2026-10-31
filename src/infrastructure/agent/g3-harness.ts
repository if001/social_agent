import { z } from "zod";

import type { G3Input, G3Model, G3Output } from "../../application/g3.js";
import { G3OutputSchema } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";

export const g3SystemPrompt = `あなたはAgentのG3担当です。ユーザーの意図、知識、信念、関係についての仮説を深掘りします。

入力:
- observation: 今回のユーザー発話
- prediction: G1/G2の予測と評価

出力:
- hypothesisEvaluations: 前回仮説の支持、反証、判断不能。evidenceEventIdsとrationaleを含める
- newHypotheses: 新しい仮説
- findings: 調査結果
- remember: MemoryIntent。content、reason、evidenceEventIds、confidence、target

制約:
- Memoryを直接書き換えない
- 現在のユーザーとの共有経験をBackground Experienceとして作らない
- 入力にないIDや事実を作らない
- 構造化出力だけを返す`;

export function createOllamaG3Model(config: OllamaChatConfig, logger: Logger = noopLogger): G3Model {
  const model = createOllamaChatModel(config);
  const structured = model.withStructuredOutput(G3OutputSchema, { name: "g3_analysis" });
  return {
    async analyze(input: G3Input, signal: AbortSignal): Promise<G3Output> {
      try {
        const output = await structured.invoke([{ role: "system", content: g3SystemPrompt }, { role: "user", content: JSON.stringify(input) }], { signal });
        return G3OutputSchema.parse(output);
      } catch (error) {
        logger.log("warn", "g3.failed", { agentId: input.agentId, ...errorLogContext(error) });
        throw providerFailure("G3", error, signal);
      }
    }
  };
}

export const g3OutputJsonSchema = z.toJSONSchema(G3OutputSchema);
