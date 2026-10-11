import { z } from "zod";

import { ReflectionInputSchema, ReflectionOutputSchema, type ReflectionInput, type ReflectionModel, type ReflectionOutput } from "../../application/reflection.js";
import { DomainError } from "../../domain/contracts.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";

export const reflectionSystemPrompt = `あなたは一個体として経験を蓄積するAgentのReflection担当です。

Event logと既存Memoryを振り返り、重要な経験のMemory化、Concern、Relationship、Mood、Selfの長期変化を一つのmaintenance結果として返します。
単発の弱い経験だけでSelfを変更しません。Self変更には反復、強い経験、または既存Selfとの明確な矛盾を示す入力Memory IDを根拠として指定します。
事実を創作せず、入力外のIDを使いません。変更がなければ各配列を空にします。Actionやユーザー向け応答は生成しません。`;

export class OllamaReflectionModel implements ReflectionModel {
  readonly #structured;
  constructor(config: OllamaChatConfig) { this.#structured = createOllamaChatModel(config).withStructuredOutput(ReflectionOutputSchema, { name: "reflection" }); }
  async reflect(rawInput: ReflectionInput, signal: AbortSignal): Promise<ReflectionOutput> {
    const input = ReflectionInputSchema.parse(rawInput);
    const messages: { role: "system" | "user"; content: string }[] = [{ role: "system", content: reflectionSystemPrompt }, { role: "user", content: JSON.stringify({ promptVersion: "reflection-v1-ja", input }) }];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return ReflectionOutputSchema.parse(await this.#structured.invoke(messages, { signal })); }
      catch (error) {
        if (signal.aborted) throw providerFailure("Reflection", error, signal);
        const schemaFailure = error instanceof z.ZodError || /schema|structured|parse|validation|required|invalid/i.test(error instanceof Error ? error.message : "");
        if (!schemaFailure) throw providerFailure("Reflection", error, signal);
        if (attempt === 1) throw new DomainError("VALIDATION", "Reflection output failed schema validation", { cause: error });
        messages.push({ role: "user", content: "直前の出力をReflectionOutput schemaへ適合させ、入力に存在する根拠だけを使って再生成してください。" });
      }
    }
    throw new DomainError("VALIDATION", "Reflection output failed schema validation");
  }
}
