import { ChatOllama } from "@langchain/ollama";
import { z, type ZodType } from "zod";

import { CandidateDetectionOutputSchema, ContinuityOutputSchema, DomainError, MemoryExtractionOutputSchema, type CandidateDetectionInput, type CandidateDetectionOutput, type ContinuityInput, type ContinuityOutput, type MemoryExtractionInput, type MemoryExtractionOutput } from "../../domain/contracts.js";

export interface ContinuityHarness { run(input: ContinuityInput, signal: AbortSignal): Promise<ContinuityOutput>; }
export interface MemoryExtractionHarness { run(input: MemoryExtractionInput, signal: AbortSignal): Promise<MemoryExtractionOutput>; }
export interface CandidateDetectorHarness { run(input: CandidateDetectionInput, signal: AbortSignal): Promise<CandidateDetectionOutput>; }

export const continuitySystemPrompt = `あなたはソーシャルエージェントの継続状態更新担当です。

目的:
完了済みの一回のInteractionを振り返り、次のEventにも影響する変化だけを提案します。応答、Emotion、Desire、Memory、Long-term Candidateは生成しません。

入力:
run、observation、直近のobservation、persona、self、現在のdynamicState、socialContext、intentions、Interactionの意味づけと最終action、短く要約したTool結果です。

出力:
- persistentStateUpdates: targetは mood | drives | currentInterests | socialContextだけです。operation、value、reason、evidenceIdsを必ず指定します
- intentionProposals: 新規はoperation=create、description、reasonを必須とします。既存更新はoperation=update、intentionId、reasonを必須とします

判断:
一時的な反応は更新しません。次回以降も続く根拠がある項目だけを返します。変化がなければ両配列を空にします。

空出力例:
{"persistentStateUpdates":[],"intentionProposals":[]}

更新例:
{"persistentStateUpdates":[{"target":"mood","operation":"set","value":"会話を受けて穏やかに集中している","reason":"次の判断にも続く気分だから","evidenceIds":["入力のeventId"]}],"intentionProposals":[{"operation":"create","description":"次回、調査結果を報告する","reason":"継続して行う方針が生じた"}]}`;

export const memoryExtractionSystemPrompt = `あなたはソーシャルエージェントのEpisodic Memory抽出担当です。

目的:
完了済みInteractionから、後の判断を変え得る具体的な経験だけを0件以上抽出します。状態、Intention、Candidate、応答は生成しません。

入力:
Eventと直近文脈、現在状態、Interactionの意味づけと応答、短く要約したTool結果、参照可能なWeb Snapshot IDです。

出力:
memoryProposalsの各要素はcontent、relatedSubjectIds、relatedIntentionIds、importance、retrievalPriorityを必須とし、必要ならwebSnapshotIdsを指定します。kind、agentId、eventId、時刻、保存ID、source provenanceはRuntimeが付与するため出力しません。

判断:
約束、決定、関係上重要な出来事、後で使うTool結果を保存します。雑談や既存Memoryの単なる反復は保存しません。Web本文を複製せず、何を調べ何を確認したかを要約します。

空出力例:
{"memoryProposals":[]}

保存例:
{"memoryProposals":[{"content":"ユーザーの依頼で対象を調べ、主要な条件を確認した","relatedSubjectIds":["入力にあるsubjectId"],"relatedIntentionIds":[],"importance":"次の回答で調査結果を再利用できる","retrievalPriority":"normal","webSnapshotIds":["入力にあるsnapshotId"]}]}`;

export const candidateDetectorSystemPrompt = `あなたは長期変化のCandidate検出担当です。

目的:
保存済みEpisodic Memoryを根拠に、Long-term Reviewへ送る候補だけを提案します。長期状態やMemoryを直接変更しません。

入力:
Agentのselfと、保存済みIDを持つMemoryです。

出力:
longTermCandidatesの各要素はtarget、proposal、reason、evidenceMemoryIds、evidenceEventIdsを返します。evidenceMemoryIdsは入力に存在する保存済みIDを1件以上含めます。

判断:
単発で一時的な経験なら空配列にします。安定した知識、自己関連の反復、既存Selfとの矛盾がある場合だけ候補を作ります。

空出力例:
{"longTermCandidates":[]}

候補例:
{"longTermCandidates":[{"target":"selfNarrative","proposal":"確認を重ねてから判断する傾向がある","reason":"同じ傾向を示す保存済み経験がある","evidenceMemoryIds":["入力にあるmemoryId"],"evidenceEventIds":[]}]}`;

export type OllamaPostProcessConfig = { readonly baseUrl: string; readonly apiKey: string; readonly model: string };

function structuredHarness<O>(config: OllamaPostProcessConfig, schema: ZodType<O>, name: string, prompt: string): { run(input: unknown, signal: AbortSignal): Promise<O> } {
  const model = new ChatOllama({ model: config.model, baseUrl: config.baseUrl, headers: { Authorization: `Bearer ${config.apiKey}` }, checkOrPullModel: false });
  const structured = model.withStructuredOutput(schema, { name });
  return { async run(input, signal) {
    const messages: { role: "system" | "user"; content: string }[] = [{ role: "system", content: prompt }, { role: "user", content: JSON.stringify({ promptVersion: `${name}-v2-ja`, input }) }];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return schema.parse(await structured.invoke(messages, { signal })); }
      catch (error) {
        if (signal.aborted) throw new DomainError("ABORTED", `${name} was interrupted`, { cause: error });
        const detail = error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") : error instanceof Error ? error.message : "unknown schema error";
        const schemaFailure = error instanceof z.ZodError || /schema|structured|parse|validation|required|invalid/i.test(detail);
        if (!schemaFailure) throw new DomainError("EXTERNAL", `${name} provider failed`, { cause: error });
        if (attempt === 1) throw new DomainError("VALIDATION", `${name} output failed schema validation: ${detail}`, { cause: error });
        messages.push({ role: "user", content: `直前の出力はSchemaに適合しませんでした。Toolや外部処理を行わず、最初の入力を再評価して完全な構造化出力だけを返してください。検証内容: ${detail.slice(0, 2_000)}` });
      }
    }
    throw new DomainError("VALIDATION", `${name} output failed schema validation`);
  } };
}

export function createOllamaPostProcessHarnesses(config: OllamaPostProcessConfig): { continuity: ContinuityHarness; memory: MemoryExtractionHarness; candidate: CandidateDetectorHarness } {
  return {
    continuity: structuredHarness(config, ContinuityOutputSchema, "continuity_update", continuitySystemPrompt),
    memory: structuredHarness(config, MemoryExtractionOutputSchema, "episodic_memory_extraction", memoryExtractionSystemPrompt),
    candidate: structuredHarness(config, CandidateDetectionOutputSchema, "candidate_detection", candidateDetectorSystemPrompt)
  };
}
