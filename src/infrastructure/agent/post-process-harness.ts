import { ChatOllama } from "@langchain/ollama";
import { z, type ZodType } from "zod";

import { CandidateDetectionOutputSchema, ContinuityOutputSchema, DomainError, MemoryExtractionOutputSchema, type CandidateDetectionInput, type CandidateDetectionOutput, type ContinuityInput, type ContinuityOutput, type MemoryExtractionInput, type MemoryExtractionOutput } from "../../domain/contracts.js";

export interface ContinuityHarness { run(input: ContinuityInput, signal: AbortSignal): Promise<ContinuityOutput>; }
export interface MemoryExtractionHarness { run(input: MemoryExtractionInput, signal: AbortSignal): Promise<MemoryExtractionOutput>; }
export interface CandidateDetectorHarness { run(input: CandidateDetectionInput, signal: AbortSignal): Promise<CandidateDetectionOutput>; }

export const continuitySystemPrompt = `あなたはソーシャルエージェントの継続状態更新担当です。

目的:
完了済みの一回のInteractionを振り返り、次のEventにも影響する変化だけを提案します。応答、Emotion、Memory、Long-term Candidateは生成しません。

入力:
run、observation、直近のobservation、persona、self、現在のdynamicState、socialContext、intentions、Interactionの意味づけと最終action、短く要約したTool結果です。

出力:
- persistentStateUpdates: targetは mood | socialContextだけです。operation、value、reason、evidenceIdsを必ず指定します
- driveProposals: 比較的持続して求めることの生成、維持、更新、統合、終了を提案します。operationはcreate | maintain | update | merge | endです。意味内容、理由、入力に存在するEventまたはMemoryのevidenceIdsを必須とし、ID、所有Agent、sinceは出力しません
- currentInterestProposals: 現在注意が向く対象のcreate | progress | reframe | resolve | dropです。createはfocus、goal、progress、progressはinterestIdと新しい段階値、reframeはinterestId、focus、goal、progress、resolve / dropはinterestIdを返します。focusは現在の興味対象、goalは最終目的ではなく現在の知識や経験に応じた当面の満足点です。progressは0 | 25 | 50 | 75 | 100だけです。reasonと入力に存在するevidenceIdsを必須とし、保存ID、時刻、停滞回数、cooldownは出力しません
- intentionProposals: 新規はoperation=create、description、reasonを必須とし、実行契機が明確ならtriggerまたはnextReviewAtを指定します。既存更新はoperation=update、intentionId、reasonを必須とします。時刻、Event、idle、manual-reviewのどれを契機に再評価するか判断できる場合はtriggerを指定してください。指定しない新規IntentionにはRuntimeが既定の再評価時刻を付与します

判断:
1. ObservationとInteractionのsubjectiveMeaningから、今回の出来事がこのAgentにとって持つ主観的価値を確認します。
2. selfのshared・initial・acquired Disposition、Values、Self Narrativeと、Memory、Social Context、現在のMood・Drive・Current Interestを照合します。
3. 具体的なEventまたはMemoryを根拠に、次回以降も比較的持続して求めることだけをDriveとして提案します。SelfやDispositionだけから自動生成しません。
4. Persona、今回限りのEmotion、単発の好悪だけを根拠にDriveへ昇格させません。
5. 既存Driveがそのまま続くならmaintain、意味を修正するならupdate、重複をまとめるならmerge、解消または不要ならendを使います。変更も確認も不要な既存Driveは省略できます。
6. sinceはRuntimeが作成時に付与し、maintain、update、mergeでは元の開始時刻を保持します。
7. 今回の経験が既存Current Interestに関係する場合、新規createより既存Interestのprogress、reframe、resolve、dropを優先します。追加行動で理解や経験が大きく更新される見込みが薄く、現在のgoalを十分満たしたと判断した場合はresolveします。価値が薄れたか進展が見込めなければdropします。
8. Current Interestが収束しても、後で説明・共有・実行する必要が残る場合は、その具体的行動だけをIntentionとして提案できます。発信相手や機会が現在ないことだけを理由に、満たしたCurrent Interestを維持しません。
9. 行動可能なCurrent Interestが存在しない、すべてcooldown中、または既存Interestが今回の経験で収束した場合は、最近の会話、Social Context、Memory、Tool結果、Web Snapshot、Drive、Intentionの結果、Self Interest / Preferenceから新しいfocusを検討します。今回の経験から具体的なfocusと当面のgoalが生じ、次のEventにも注意を持ち越す価値がある場合だけcreateし、件数を満たす目的では作りません。
10. progressは知識量の精密な割合ではなく、当面のgoalに対する粗い自己評価です。同じ段階のprogressは進展なしを意味します。詳細知識やWeb本文をCurrent Interestへ入れません。
変化がなければ4配列を空にします。

空出力例:
{"persistentStateUpdates":[],"driveProposals":[],"currentInterestProposals":[],"intentionProposals":[]}

生成例:
{"persistentStateUpdates":[],"driveProposals":[{"operation":"create","description":"未解決の原因を理解したい","reason":"技術的な不一致を重要な未解決事項と意味づけた","evidenceIds":["入力のeventId"]}],"currentInterestProposals":[{"operation":"create","focus":"不一致が起きる条件","goal":"再現条件と原因候補を説明できる","progress":25,"reason":"Tool結果から関心対象と一部の条件が具体化した","evidenceIds":["入力のeventId"]}],"intentionProposals":[]}

維持例:
{"persistentStateUpdates":[],"driveProposals":[{"operation":"maintain","driveDescription":"未解決の原因を理解したい","reason":"関連する新しい手掛かりがあり、求めている理解はまだ得られていない","evidenceIds":["入力のeventId"]}],"currentInterestProposals":[],"intentionProposals":[]}

更新・統合例:
{"persistentStateUpdates":[],"driveProposals":[{"operation":"update","driveDescription":"仕組みを知りたい","description":"失敗条件まで含めて仕組みを理解したい","reason":"今回の失敗で理解すべき範囲が具体化した","evidenceIds":["入力のeventId"]}],"currentInterestProposals":[{"operation":"progress","interestId":"入力にあるinterestId","progress":75,"reason":"主要条件を確認できた","evidenceIds":["入力のeventId"]}],"intentionProposals":[]}

終了例:
{"persistentStateUpdates":[],"driveProposals":[{"operation":"end","driveDescription":"未解決の原因を理解したい","reason":"根拠を確認して原因を理解できた","evidenceIds":["入力のeventId"]}],"currentInterestProposals":[{"operation":"resolve","interestId":"入力にあるinterestId","reason":"Goalを満たした","evidenceIds":["入力のeventId"]}],"intentionProposals":[]}`;

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
