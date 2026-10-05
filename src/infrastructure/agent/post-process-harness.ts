import { ChatOllama } from "@langchain/ollama";

import { DomainError, PostProcessOutputSchema, type PostProcessInput, type PostProcessOutput } from "../../domain/contracts.js";

export interface PostProcessHarness {
  run(input: PostProcessInput, signal: AbortSignal): Promise<PostProcessOutput>;
}

export const postProcessSystemPrompt = `あなたはソーシャルエージェントの応答後Post-processです。

目的:
完了済みInteractionの入力、最終応答、Emotion・Desire、Tool実行結果を振り返り、次のEventにも残す意味がある情報だけを構造化して提案します。ユーザーへの応答やTool実行は行いません。

出力:
- persistentStateUpdates: Mood、Drive、Current Interest、Working Social Contextの更新。targetは mood | drives | currentInterests | socialContextだけです
- memoryProposals: 後の判断を変え得る具体的な出来事のEpisodic Memory。Web本文は複製せず「何を調べ、何を確認したか」という概要とwebSnapshotIdsを保存します
- intentionProposals: 継続する行動方針の作成・更新
- longTermCandidates: 長期Selfや安定した知識を後でReviewする候補

制約:
- EmotionとDesire、ユーザーへのactionは出力しません
- 変化の根拠が弱い項目は更新せず、対応する配列を空にします
- IDを参照する場合は入力中に存在するIDだけを使います
- evidenceEventIdsには今回のinteractionInput.run.eventIdを使えます
- Tool結果を経験として残す場合も、本文ではなく実行目的と確認した要点をMemoryにします
- 保存用ID、所有Agent ID、作成時刻、statusは生成しません`;

export type OllamaPostProcessConfig = { readonly baseUrl: string; readonly apiKey: string; readonly model: string };

export function createOllamaPostProcessHarness(config: OllamaPostProcessConfig): PostProcessHarness {
  const model = new ChatOllama({ model: config.model, baseUrl: config.baseUrl, headers: { Authorization: `Bearer ${config.apiKey}` }, checkOrPullModel: false });
  const structured = model.withStructuredOutput(PostProcessOutputSchema, { name: "post_process_output" });
  return {
    async run(input, signal) {
      try {
        return PostProcessOutputSchema.parse(await structured.invoke([
          { role: "system", content: postProcessSystemPrompt },
          { role: "user", content: JSON.stringify({ promptVersion: "post-process-v1-ja", input }) }
        ], { signal }));
      } catch (error) {
        if (signal.aborted) throw new DomainError("ABORTED", "Post-process was interrupted", { cause: error });
        throw new DomainError("EXTERNAL", "Post-process provider failed", { cause: error });
      }
    }
  };
}
