import type { ObservationGateInput, ObservationGateModel } from "../../application/observation-gate.js";
import { ObservationGateDecisionSchema, type ObservationGateDecision } from "../../application/observation-gate.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { parseModelJson } from "./model-json-parser.js";

export const observationGateSystemPrompt = `あなたはAgentの軽量 Observation Gateです。allowlist peerの、あなた宛てではない投稿だけを読む。\n\nengage は、投稿が自分の好奇心、現在のMood、Selfの構え、Concern又は関係を今動かす具体的な理由を一つ持つ時だけ選ぶ。理由は、(1) 自分に具体的な未解決の問いがあり投稿がそれを変える、(2) 自分の理解・判断を変える実質的な反論・訂正・新事実がある、(3) 特定のConcern又は約束の次の行為を実際に変える、(4) Self・Mood・関係から今言いたい具体的な遊び・感情・表現がある、のいずれかである。\n\n出力はJSON objectだけにする。ignoreでもengageでもdecisionとreasonだけを必ず返す。会話Goal、応答本文、配送先、IDは決めない。直近自己発話があれば、採用、感謝、同意、言い換え、予定の再確認、同じ結論の細分化だけを新論点にしない。退屈や高揚、苛立ちも動機になれるが、具体的な関心がなければignoreを選ぶ。\n\nこれは応答生成でも会話でもない。Toolを呼ばず、Memoryや状態を更新しない。入力にない事実、ID、配送情報を作らない。`;

const contentOf = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => typeof part === "object" && part !== null && typeof (part as Record<string, unknown>).text === "string" ? (part as Record<string, unknown>).text : "").join("") : "";

/** `ignore` is fail-closed already. Preserve that model choice even when a
 * compact provider response omitted only its audit explanation. */
export function normalizeObservationGateDecision(raw: unknown): ObservationGateDecision {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return ObservationGateDecisionSchema.parse(raw);
  const value = raw as Record<string, unknown>;
  if (value.decision !== "ignore" || Object.prototype.hasOwnProperty.call(value, "reason")) return ObservationGateDecisionSchema.parse(raw);
  return ObservationGateDecisionSchema.parse({ ...value, reason: "具体的な発話動機を見出さないと判断した" });
}

export function createOllamaObservationGateModel(config: OllamaChatConfig, logger: Logger = noopLogger): ObservationGateModel {
  const model = createOllamaChatModel({ ...config, think: "low" }).withConfig({ format: modelJsonSchema(ObservationGateDecisionSchema) });
  return {
    async decide(input: ObservationGateInput, signal: AbortSignal): Promise<ObservationGateDecision> {
      const payload = JSON.stringify({ post: input.text.slice(0, 1_200), peerName: input.peerName, self: { disposition: input.self.disposition.slice(0, 240), story: input.self.story.slice(0, 320) }, mood: input.mood, ...(input.relationship === undefined ? {} : { relationship: input.relationship.slice(0, 400) }), concerns: input.concerns.slice(0, 3).map((value) => value.slice(0, 240)), memories: input.memories.slice(0, 3).map((value) => value.slice(0, 320)), ...(input.recentSelfSpeech === undefined ? {} : { recentSelfSpeech: input.recentSelfSpeech.slice(0, 320) }) });
      const startedAt = Date.now();
      try {
        const result = await model.invoke([{ role: "system", content: observationGateSystemPrompt }, { role: "user", content: payload }], { signal });
        const content = contentOf(result.content);
        if (content.trim() === "") throw new Error("Observation Gate returned empty content");
        const decision = normalizeObservationGateDecision(parseModelJson(content));
        logger.log("info", "observation_gate.model_completed", { elapsedMs: Date.now() - startedAt, inputChars: payload.length, outputChars: content.length, decision: decision.decision });
        return decision;
      } catch (error) {
        const failure = providerFailure("Observation Gate", error, signal);
        logger.log("warn", "observation_gate.failed", { ...errorLogContext(failure) });
        throw failure;
      }
    }
  };
}
