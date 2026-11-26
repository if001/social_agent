import type { PeerInitiationModel } from "../../application/peer-initiation-gate.js";
import { PeerInitiationDecisionSchema, type PeerInitiationDecision } from "../../application/peer-initiation-gate.js";
import type { AgentCoreInput } from "../../domain/contracts.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { parseModelJson } from "./model-json-parser.js";

export const peerInitiationGateSystemPrompt = `あなたはAgentの軽量 Peer Initiation Gateです。自律Eventで今allowlist peerへ会話を始める具体的な自分の動機があるかだけを判定する。好奇心、反論、遊び、共有、協力、苛立ちなどは動機になれるが、礼儀、退屈しのぎ、返答待ち、相手に役立つはずという推測だけでは始めない。initiateではallowlistの自然言語表示名と短い理由だけを返す。本文、Conversation Goal、配送先、IDを作らない。出力はJSON objectだけにする。`;
const contentOf = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => typeof part === "object" && part !== null && typeof (part as Record<string, unknown>).text === "string" ? (part as Record<string, unknown>).text : "").join("") : "";

export function createOllamaPeerInitiationGateModel(config: OllamaChatConfig, logger: Logger = noopLogger): PeerInitiationModel {
  const model = createOllamaChatModel({ ...config, think: "low" }).withConfig({ format: modelJsonSchema(PeerInitiationDecisionSchema) });
  return { async decide(input: AgentCoreInput, peers, signal): Promise<PeerInitiationDecision> {
    const payload = JSON.stringify({ event: input.observation.summary.slice(0, 800), self: { disposition: input.currentSelf.disposition.slice(0, 320), story: input.currentSelf.selfStory.slice(0, 320) }, mood: input.state.mood, concerns: input.state.concerns.slice(0, 3).map(({ description }) => description.slice(0, 240)), peers });
    const startedAt = Date.now();
    try {
      const result = await model.invoke([{ role: "system", content: peerInitiationGateSystemPrompt }, { role: "user", content: payload }], { signal });
      const content = contentOf(result.content); if (content.trim() === "") throw new Error("Peer Initiation Gate returned empty content");
      const decision = PeerInitiationDecisionSchema.parse(parseModelJson(content));
      logger.log("info", "peer_initiation_gate.model_completed", { elapsedMs: Date.now() - startedAt, inputChars: payload.length, outputChars: content.length, decision: decision.decision });
      return decision;
    } catch (error) { const failure = providerFailure("Peer Initiation Gate", error, signal); logger.log("warn", "peer_initiation_gate.failed", { ...errorLogContext(failure) }); throw failure; }
  } };
}
