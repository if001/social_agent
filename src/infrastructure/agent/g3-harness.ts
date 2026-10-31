import { createDeepAgent } from "deepagents";
import { toolStrategy } from "langchain";

import type { G3Input, G3Model, G3Output } from "../../application/g3.js";
import { ToolRegistry } from "../../application/tool-registry.js";
import { G3OutputSchema } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { createDeepAgentTools, createDeepAgentToolRunContext, DeepAgentToolRunContextSchema } from "./deep-agent-tools.js";
import { modelJsonSchema } from "./model-json-schema.js";

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
- 必要ならretrieval_search、self_get、concern_list、concern_getで確認する
- 構造化出力だけを返す`;

const g3ToolNames = new Set(["retrieval_search", "self_get", "concern_list", "concern_get"]);

export function createOllamaG3Model(config: OllamaChatConfig & { readonly toolRegistry?: ToolRegistry }, logger: Logger = noopLogger): G3Model {
  const model = createOllamaChatModel(config);
  const all = config.toolRegistry?.registered() ?? [];
  const selected = all.filter(({ name }) => g3ToolNames.has(name));
  const registry = new ToolRegistry(selected);
  const tools = createDeepAgentTools(registry, () => new Date(), logger);
  const responseFormat = toolStrategy(modelJsonSchema(G3OutputSchema), { handleError: (error) => {
    logger.log("warn", "g3.structured_output_invalid", errorLogContext(error));
    return "最終出力がSchema不一致です。本文やMarkdownを返さず、構造化出力専用Toolを1回だけ呼んでください。";
  } });
  const agent = createDeepAgent({ model, tools, systemPrompt: g3SystemPrompt, responseFormat, contextSchema: DeepAgentToolRunContextSchema });
  return {
    async analyze(input: G3Input, signal: AbortSignal): Promise<G3Output> {
      try {
        const context = createDeepAgentToolRunContext({ agentId: input.agentId, runId: input.sourcePredictionId, eventId: input.sourceEventId, eventKind: "internal", maxModelCalls: 4, maxToolCalls: 8, signal });
        const result = await agent.invoke({ messages: [{ role: "user", content: JSON.stringify(input) }] }, { signal, recursionLimit: 16, context: context as never });
        return G3OutputSchema.parse(result.structuredResponse);
      } catch (error) {
        logger.log("warn", "g3.failed", { agentId: input.agentId, ...errorLogContext(error) });
        throw providerFailure("G3", error, signal);
      }
    }
  };
}
