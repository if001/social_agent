import type { ContinuityHarness, MemoryExtractionHarness, CandidateDetectorHarness } from "../../application/post-process-ports.js";
import { createOllamaChatModel, providerFailure, type OllamaChatConfig } from "./ollama-provider.js";
import { z, type ZodType } from "zod";

import { CandidateDetectionOutputSchema, ContinuityOutputSchema, DomainError, MemoryExtractionOutputSchema, type ContinuityInput } from "../../domain/contracts.js";

export const continuitySystemPrompt = `あなたはソーシャルエージェントの継続状態更新担当です。

目的:
完了済みの一回のInteractionを振り返り、次のEventにも影響する変化だけを提案します。応答、Emotion、Memory、Long-term Candidateは生成しません。

入力:
run、observation、recentExperiences、persona、self、現在のdynamicState、socialContext、InteractionのsubjectiveMeaning、activeMotive、最終action、短く要約したTool結果です。

出力:
- persistentStateUpdates: targetはmood | socialContextだけ。operation、value、reason、evidenceIdsを指定します
- motiveProposals: 持続するMotiveのcreate | maintain | update | merge | resolve | dropです。根拠となるEventまたはMemoryのevidenceIdsを必須とします。ID、所有Agent、since、探索metadataはRuntimeが管理します

判断:
1. 今回のactiveMotiveがその場で満たされたなら保存しません。次のEventにも残る現在の動機だけをMotiveとして提案します。
2. 既存Motiveが続くならmaintain、意味や当面の満足点が変わるならupdate、重複はmerge、満たされたならresolve、価値や進展可能性を失ったならdropを使います。
3. 探索型Motiveには任意のgoalとprogress（0 | 25 | 50 | 75 | 100）を対で指定できます。goalは関心全体の終了条件ではなく当面の満足点、progressは粗い目安です。探索以外には付けません。
4. Self Interest、Preference、Dispositionだけを持続Motiveへ機械的に変換しません。今回のEventまたはMemoryに具体的根拠が必要です。
5. 詳細知識やWeb本文をMotiveへ入れません。変更も確認も不要なら提案を省略できます。

空出力例:
{"persistentStateUpdates":[],"motiveProposals":[]}

生成例:
{"persistentStateUpdates":[],"motiveProposals":[{"operation":"create","description":"不一致の原因を理解したい","goal":"再現条件と原因候補を説明できる","progress":25,"reason":"Tool結果から未解決点が具体化した","evidenceIds":["入力のeventId"]}]}

更新例:
{"persistentStateUpdates":[],"motiveProposals":[{"operation":"update","motiveId":"入力にあるmotiveId","description":"失敗条件まで含めて仕組みを理解したい","goal":"主要な失敗条件を説明できる","progress":75,"reason":"主要条件を確認できた","evidenceIds":["入力のeventId"]}]}

終了例:
{"persistentStateUpdates":[],"motiveProposals":[{"operation":"resolve","motiveId":"入力にあるmotiveId","reason":"当面のGoalを満たした","evidenceIds":["入力のeventId"]}]}`

export const memoryExtractionSystemPrompt = `あなたはソーシャルエージェントのEpisodic Memory抽出担当です。

目的:
完了済みInteractionから、後の判断を変え得る具体的な経験だけを0件以上抽出します。状態、Candidate、応答は生成しません。

入力:
Eventと直近文脈、現在状態、Interactionの意味づけと応答、短く要約したTool結果、参照可能なWeb Snapshot IDです。

出力:
memoryProposalsの各要素はcontent、relatedSubjectIds、importance、retrievalPriorityを必須とし、必要ならwebSnapshotIdsを指定します。kind、agentId、eventId、時刻、保存ID、source provenanceはRuntimeが付与するため出力しません。

判断:
約束、決定、関係上重要な出来事、後で使うTool結果を保存します。雑談や既存Memoryの単なる反復は保存しません。Web本文を複製せず、何を調べ何を確認したかを要約します。

空出力例:
{"memoryProposals":[]}

保存例:
{"memoryProposals":[{"content":"ユーザーの依頼で対象を調べ、主要な条件を確認した","relatedSubjectIds":["入力にあるsubjectId"],"importance":"次の回答で調査結果を再利用できる","retrievalPriority":"normal","webSnapshotIds":["入力にあるsnapshotId"]}]}`;

export const experienceIntegrationSystemPrompt = `${continuitySystemPrompt}\n\n同じInteractionからEpisodic Memoryも同時に抽出します。別のmodel callへ分割せず、上記のpersistentStateUpdatesとmotiveProposalsに加えてmemoryProposalsを返してください。\n\n${memoryExtractionSystemPrompt}`;

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

export type OllamaPostProcessConfig = OllamaChatConfig;

function structuredHarness<O>(config: OllamaPostProcessConfig, schema: ZodType<O>, name: string, prompt: string): { run(input: unknown, signal: AbortSignal): Promise<O> } {
  const model = createOllamaChatModel(config);
  const structured = model.withStructuredOutput(schema, { name });
  return { async run(input, signal) {
    const messages: { role: "system" | "user"; content: string }[] = [{ role: "system", content: prompt }, { role: "user", content: JSON.stringify({ promptVersion: `${name}-v2-ja`, input }) }];
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try { return schema.parse(await structured.invoke(messages, { signal })); }
      catch (error) {
        if (signal.aborted) throw providerFailure(name, error, signal);
        const detail = error instanceof z.ZodError ? error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ") : error instanceof Error ? error.message : "unknown schema error";
        const schemaFailure = error instanceof z.ZodError || /schema|structured|parse|validation|required|invalid/i.test(detail);
        if (!schemaFailure) throw providerFailure(name, error, signal);
        if (attempt === 1) throw new DomainError("VALIDATION", `${name} output failed schema validation: ${detail}`, { cause: error });
        messages.push({ role: "user", content: `直前の出力はSchemaに適合しませんでした。Toolや外部処理を行わず、最初の入力を再評価して完全な構造化出力だけを返してください。検証内容: ${detail.slice(0, 2_000)}` });
      }
    }
    throw new DomainError("VALIDATION", `${name} output failed schema validation`);
  } };
}

export function createOllamaPostProcessHarnesses(config: OllamaPostProcessConfig): { continuity: ContinuityHarness; memory: MemoryExtractionHarness; candidate: CandidateDetectorHarness } {
  const combinedSchema = ContinuityOutputSchema.extend({ memoryProposals: MemoryExtractionOutputSchema.shape.memoryProposals });
  const combined = structuredHarness(config, combinedSchema, "experience_integration", experienceIntegrationSystemPrompt);
  const cache = new Map<string, Promise<z.infer<typeof combinedSchema>>>();
  const run = (input: ContinuityInput, signal: AbortSignal): Promise<z.infer<typeof combinedSchema>> => {
    const key = input.run.runId;
    let pending = cache.get(key);
    if (pending === undefined) {
      pending = combined.run(input, signal);
      cache.set(key, pending);
      if (cache.size > 100) cache.delete(cache.keys().next().value ?? key);
    }
    return pending;
  };
  return {
    continuity: { run: async (input, signal) => { const output = await run(input, signal); return { persistentStateUpdates: output.persistentStateUpdates, motiveProposals: output.motiveProposals }; } },
    memory: { run: async (input, signal) => { const output = await run(input, signal); cache.delete(input.run.runId); return { memoryProposals: output.memoryProposals }; } },
    candidate: structuredHarness(config, CandidateDetectionOutputSchema, "candidate_detection", candidateDetectorSystemPrompt)
  };
}
