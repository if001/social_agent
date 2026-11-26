import type { ConcernImpactInput, ConcernImpactModel } from "../../application/concern-reevaluation.js";
import { ConcernImpactSchema } from "../../application/concern-reevaluation.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { parseModelJson } from "./model-json-parser.js";

const prompt = "あなたはConcern impact判定担当です。今回確定した経験が、Runtimeで一件に固定されたConcernから別の持続的関心をforkする再検討を必要とするかだけを判断する。Memoryが保存されたこと、単なる進展、予定、会話の要約、同じConcernの詳細化はreconsiderにしない。decisionはnone又はreconsider、reasonは短く返す。ID、候補番号、status、行動計画を出さない。";

const text = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => typeof part === "object" && part !== null && typeof (part as Record<string, unknown>).text === "string" ? (part as Record<string, unknown>).text as string : "").join("") : "";

export function createOllamaConcernImpactModel(config: OllamaChatConfig, logger: Logger = noopLogger): ConcernImpactModel {
  const model = createOllamaChatModel({ ...config, think: "low" }).withConfig({ format: modelJsonSchema(ConcernImpactSchema) });
  return { async assess(input: ConcernImpactInput, signal: AbortSignal): Promise<unknown> {
    const content = JSON.stringify({ focusConcern: input.focus, experience: input.experienceSummary, memories: input.memories });
    const startedAt = Date.now();
    try {
      const result = await model.invoke([{ role: "system", content: prompt }, { role: "user", content }], { signal });
      const output = text(result.content);
      if (output.trim() === "") throw new Error("Concern impact returned empty content");
      logger.log("info", "concern_impact.model_completed", { agentId: input.source.agentId, sourceId: input.source.sourceId, elapsedMs: Date.now() - startedAt, inputChars: content.length, outputChars: output.length });
      return parseModelJson(output);
    } catch (error) {
      const failure = providerFailure("Concern impact", error, signal);
      logger.log("warn", "concern_impact.failed", { agentId: input.source.agentId, sourceId: input.source.sourceId, ...errorLogContext(failure) });
      throw failure;
    }
  } };
}
