import type { ConcernNormalizationDecision, ConcernNormalizationModel, ConcernNormalizationModelInput } from "../../application/concern-normalization.js";
import { ConcernNormalizationDecisionSchema } from "../../application/concern-normalization.js";
import { errorLogContext, noopLogger, type Logger } from "../../observability/logger.js";
import { modelJsonSchema } from "./model-json-schema.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";

export const concernNormalizationSystemPrompt = `あなたは既存active Concernを現在の契約へ正規化する軽量保守担当です。

Concernは、複数EventにわたってAgentが現在も気に掛ける、一つの持続する関心または動機の核です。疑問文や解決可能な課題である必要はありません。

現在値が既にこの形で維持する場合は入力を一字も変えず、そのままdescriptionとwhyItMattersへ返します。正規化する場合は、同じ関心の核と、それが現在のSelf・感情・価値・関係に残る理由だけを短く書きます。Runtimeが入力との一致比較でkeep又はnormalizeを確定します。入力にない事実、関心、動機を追加しないでください。出来事・発見・根拠・会話の経緯・調査結果・細かな実行手順・日時・配送運用・独立した別のConcernは本文へ残しません。

作業の完了、運用方針、共有条件、約束の履行、再開判断、手順の確定をConcernの核にしないでください。それらしか書かれていないように見えても、入力に既に表れている対象への知りたい、確かめたい、見届けたい、守りたいという向きを抽出します。whyItMattersは成果の利用先や相手への有用性ではなく、現在のAgent自身の好奇心、価値、感情、関係に残る理由にします。

変換の型:
- 「定期チェックを続け、変化時だけ共有する」ではなく「その対象の変化が実際の使われ方をどう変えるか見届けたい」
- 「配信を再開するか決める」ではなく「その領域の変化を追い続けたい」
- 「正式版を完了させる」ではなく「その判別基準がどの条件で成り立つか確かめたい」
- 「判別手順を確定する」ではなく「結果の不一致が何によって生じるか知りたい」

分割、作成、終了、status変更、reconsiderAt変更は行いません。IDを推測または出力しません。Markdownや説明文を返さず、指定された構造化出力だけを返してください。`;
const concernNormalizationRepairPrompt = `${concernNormalizationSystemPrompt}\n直前の出力はschema検証に失敗しました。新しい意味判断を行わず、固定inputと直前出力を使い、descriptionとwhyItMattersを必須の文字列として修復してください。`;

function contentOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (!Array.isArray(value)) return "";
  return (value as unknown[]).map((part) => {
    if (typeof part !== "object" || part === null) return "";
    const text = (part as Record<string, unknown>)["text"];
    return typeof text === "string" ? text : "";
  }).join("");
}

export function createOllamaConcernNormalizationModel(config: OllamaChatConfig, logger: Logger = noopLogger): ConcernNormalizationModel {
  const model = createOllamaChatModel({ ...config, think: "low" }).withConfig({ format: modelJsonSchema(ConcernNormalizationDecisionSchema) });
  return {
    async normalize(input: ConcernNormalizationModelInput, signal?: AbortSignal): Promise<ConcernNormalizationDecision> {
      const effectiveSignal = signal ?? AbortSignal.timeout(120_000);
      const startedAt = Date.now();
      try {
        let repair: { readonly invalidOutput: unknown; readonly validationIssues: readonly { readonly path: PropertyKey[]; readonly message: string }[] } | undefined;
        for (let attempt = 1; attempt <= 2; attempt += 1) {
          const payload = repair === undefined ? input : { input, ...repair };
          const result = await model.invoke([{ role: "system", content: repair === undefined ? concernNormalizationSystemPrompt : concernNormalizationRepairPrompt }, { role: "user", content: JSON.stringify(payload) }], { signal: effectiveSignal });
          const text = contentOf(result.content).trim().replace(/^```(?:json)?\s*/iu, "").replace(/\s*```$/u, "");
          if (text === "") throw new Error("Concern normalization returned empty content");
          const raw: unknown = JSON.parse(text);
          const parsed = ConcernNormalizationDecisionSchema.safeParse(raw);
          if (parsed.success) {
            const decision = parsed.data;
            const operation = decision.description === input.description && decision.whyItMatters === input.whyItMatters ? "keep" : "normalize";
            logger.log("info", "concern_normalization.model_completed", { operation, attempt, elapsedMs: Date.now() - startedAt, inputChars: JSON.stringify(input).length, outputChars: text.length });
            return decision;
          }
          const record = typeof raw === "object" && raw !== null ? raw as Record<string, unknown> : undefined;
          logger.log("warn", "concern_normalization.output_invalid", { attempt, returnedKeys: record === undefined ? undefined : Object.keys(record).join(",").slice(0, 200), issueCount: parsed.error.issues.length });
          if (attempt === 2) throw parsed.error;
          repair = { invalidOutput: raw, validationIssues: parsed.error.issues.map(({ path, message }) => ({ path, message })) };
        }
        throw new Error("Concern normalization repair did not complete");
      } catch (error) {
        const failure = providerFailure("Concern normalization", error, effectiveSignal);
        logger.log("warn", "concern_normalization.failed", { ...errorLogContext(failure) });
        throw failure;
      }
    }
  };
}
