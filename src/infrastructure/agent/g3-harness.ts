import { createDeepAgent } from "deepagents";
import { toolStrategy } from "langchain";

import type { G3Input, G3Model, G3ModelResult } from "../../application/g3.js";
import { ToolRegistry } from "../../application/tool-registry.js";
import { G3OutputSchema } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { createDeepAgentTools, createDeepAgentToolRunContext, DeepAgentToolRunContextSchema } from "./deep-agent-tools.js";
import { createAgentCoreMiddleware } from "./deep-agent-middleware.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { toModelRecordView } from "./model-record-view.js";

export const g3SystemPrompt = `あなたはAgentのG3担当です。ユーザーの意図、知識、信念、関係についての仮説を深掘りします。

入力:
- observation: 今回のユーザー発話
- prediction: G1/G2の予測と評価

出力:
- hypothesisEvaluations: 前回仮説の支持、反証、判断不能。rationaleを含める。根拠RecordはRuntimeが対応付ける
- newHypotheses: 新しい仮説
- findings: 調査結果
- memories: Memory候補。content、reason、target、perspectiveだけを返す。根拠Event、subject、更新対象はRuntimeが検索結果から解決する
- 4つの配列を常に返す。該当しない項目は空配列にする
- memoriesのtargetは episodic / semantic / self-related / self-change / common-ground のいずれか、perspectiveは self / user のいずれかだけを使う

制約:
- Memoryを直接書き換えない
- 現在のユーザーとの共有経験をBackground Experienceとして作らない
- 入力にないIDや事実を作らない
- 必要ならretrieval_search、memory_search、event_search、self_get、concern_list、concern_getで確認する
- 構造化出力だけを返す`;

const g3ToolNames = new Set(["retrieval_search", "memory_search", "event_search", "self_get", "concern_list", "concern_get"]);
// G3 may inspect a few records before submitting its structured result. Reserve
// two calls for Tool-free finalization/repair, leaving four bounded calls for
// that investigation rather than the previous two.
export const G3_MAX_MODEL_CALLS = 6;
export const G3_FINALIZATION_MODEL_CALL_RESERVE = 2;
export const G3_MAX_TOOL_CALLS = 8;

export function createOllamaG3Model(config: OllamaChatConfig & { readonly toolRegistry?: ToolRegistry }, logger: Logger = noopLogger): G3Model {
  // G3 is a bounded evidence synthesis with a small flat schema. Keeping it at
  // low thinking matches G1/G2 and leaves the lease for Tool-free finalization.
  const model = createOllamaChatModel({ ...config, think: "low" });
  const all = config.toolRegistry?.registered() ?? [];
  const selected = all.filter(({ name }) => g3ToolNames.has(name));
  const registry = new ToolRegistry(selected);
  const tools = createDeepAgentTools(registry, () => new Date(), logger, toModelRecordView);
  const responseFormat = toolStrategy(modelJsonSchema(G3OutputSchema), { handleError: (error) => {
    logger.log("warn", "g3.structured_output_invalid", errorLogContext(error));
    return "最終出力がSchema不一致です。本文やMarkdownを返さず、構造化出力専用Toolを1回だけ呼んでください。hypothesisEvaluations、newHypotheses、findings、memories の4配列を必ず返します。memoriesの各要素はcontent、reason、target、perspectiveだけとし、targetは episodic / semantic / self-related / self-change / common-ground、perspectiveは self / user のいずれかだけを使います。";
  } });
  const agent = createDeepAgent({ model, tools, systemPrompt: g3SystemPrompt, responseFormat, contextSchema: DeepAgentToolRunContextSchema, middleware: [createAgentCoreMiddleware(registry, logger, () => new Date(), { allowUnregisteredTools: false })] });
  return {
    async analyze(input: G3Input, signal: AbortSignal): Promise<G3ModelResult> {
      try {
        const context = createDeepAgentToolRunContext({ agentId: input.agentId, runId: input.sourcePredictionId, eventId: input.sourceEventId, eventKind: "internal", maxModelCalls: G3_MAX_MODEL_CALLS, maxExplorationModelCalls: G3_MAX_MODEL_CALLS - G3_FINALIZATION_MODEL_CALL_RESERVE, maxToolCalls: G3_MAX_TOOL_CALLS, signal });
        const result = await agent.invoke({ messages: [{ role: "user", content: JSON.stringify(toModelRecordView(input)) }] }, { signal, recursionLimit: G3_MAX_MODEL_CALLS * 2 + G3_MAX_TOOL_CALLS + 6, context });
        return { output: G3OutputSchema.parse(result.structuredResponse), toolEvidence: context.collector.executions.map(({ name, ok, result: toolResult, error }) => ({ name, ok, ...(toolResult === undefined ? {} : { result: toolResult }), ...(error === undefined ? {} : { error }) })) };
      } catch (error) {
        logger.log("warn", "g3.failed", { agentId: input.agentId, ...errorLogContext(error) });
        throw providerFailure("G3", error, signal);
      }
    }
  };
}
