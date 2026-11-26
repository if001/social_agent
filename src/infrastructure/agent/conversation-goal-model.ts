import type { ConversationGoalModel } from "../../application/conversation-goal.js";
import { ConversationGoalSchema, type ConversationGoal } from "../../application/conversation-goal.js";
import type { ObservationGateInput } from "../../application/observation-gate.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { parseModelJson } from "./model-json-parser.js";

export const conversationGoalSystemPrompt = `あなたはAgentの会話Goal Composerです。応答本文や配送先は作らない。入力の投稿と、Agent自身が今動いた理由から、この会話で自分が得たい、確かめたい、伝えたい、又は変えたいことを一つだけ短く決める。返信すること、礼儀、協力関係の維持、予定の反復をGoalにしない。投稿にない事実、ID、相手の内心、実行手順を作らない。出力はJSON objectだけにする。`;

const contentOf = (value: unknown): string => typeof value === "string" ? value : Array.isArray(value) ? value.map((part) => typeof part === "object" && part !== null && typeof (part as Record<string, unknown>).text === "string" ? (part as Record<string, unknown>).text : "").join("") : "";

export function createOllamaConversationGoalModel(config: OllamaChatConfig, logger: Logger = noopLogger): ConversationGoalModel {
  const model = createOllamaChatModel({ ...config, think: "low" }).withConfig({ format: modelJsonSchema(ConversationGoalSchema) });
  return { async compose(input: ObservationGateInput, reason: string, signal: AbortSignal): Promise<ConversationGoal> {
    const payload = JSON.stringify({ post: input.text.slice(0, 1_200), counterpart: input.peerName, reason: reason.slice(0, 240), self: input.self, mood: input.mood.slice(0, 120), ...(input.relationship === undefined ? {} : { relationship: input.relationship.slice(0, 400) }), concerns: input.concerns.slice(0, 3), memories: input.memories.slice(0, 3), ...(input.recentSelfSpeech === undefined ? {} : { recentSelfSpeech: input.recentSelfSpeech.slice(0, 320) }) });
    const startedAt = Date.now();
    try {
      const result = await model.invoke([{ role: "system", content: conversationGoalSystemPrompt }, { role: "user", content: payload }], { signal });
      const content = contentOf(result.content);
      if (content.trim() === "") throw new Error("Conversation Goal Composer returned empty content");
      const goal = ConversationGoalSchema.parse(parseModelJson(content));
      logger.log("info", "conversation_goal.model_completed", { elapsedMs: Date.now() - startedAt, inputChars: payload.length, outputChars: content.length });
      return goal;
    } catch (error) {
      const failure = providerFailure("Conversation Goal", error, signal);
      logger.log("warn", "conversation_goal.failed", { ...errorLogContext(failure) });
      throw failure;
    }
  } };
}
