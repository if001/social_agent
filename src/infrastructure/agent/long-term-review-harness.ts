import { ChatOllama } from "@langchain/ollama";
import { createDeepAgent } from "deepagents";
import { providerStrategy } from "langchain";

import { ReviewInputSchema, ReviewOutputSchema, type ReviewHarness, type ReviewInput, type ReviewOutput } from "../../application/long-term-review.js";
import { DomainError } from "../../domain/contracts.js";

export type ReviewAgentInvoker = { invoke(input: { readonly messages: readonly { readonly role: "user"; readonly content: string }[] }, options: { readonly signal: AbortSignal; readonly recursionLimit: number }): Promise<{ readonly structuredResponse?: unknown }> };

export const longTermReviewSystemPrompt = `あなたはソーシャルエージェントのLong-term Review Coreです。

目的:
通常Agent Coreが保存した複数のLong-term Candidateと根拠Memoryをまとめて再解釈し、現在の長期状態を維持・更新・統合・破棄する判断を行います。通常の会話応答やTool実行は行いません。

入力:
- candidates: 同じAgentかつ同じtargetに属するpending Candidate
- evidence: Candidateが参照する実在Memory
- currentValue: 対象に対応する現在の長期状態、または既存のSemantic／Self-related Memory

出力:
- decisions: CandidateごとにcandidateId、decision、reasonを1件ずつ返します。decisionはKEEP、UPDATE、MERGE、DROPのいずれかです
- stateUpdate: UPDATEまたはMERGEが1件以上ある場合だけ必須です。複数Candidateを踏まえた統合後のvalue、reason、利用したevidenceMemoryIdsを返します

判断:
- KEEP: 長期変更にはまだ根拠が不足するがCandidateとして保持する
- UPDATE: 根拠が十分で、現在値を新しい理解へ更新する
- MERGE: 現在値とCandidateを統合し、重複や肥大化を避ける
- DROP: 一過性、重複、矛盾、根拠不足のため長期変更に使わない

制約:
- 入力にないCandidate ID、Memory ID、経験を作りません
- decisionsは全Candidateを重複なく1回ずつ判断します
- 単発経験だけでAcquired Dispositionを安易に変更しません
- Self Narrativeを先に更新し、Acquired Dispositionは反復または強い根拠がある場合だけ更新します
- Role、Raison d'être、長期Preference／Interestも重複を統合し、簡潔な値にします
- Semantic／Self-related Memoryは伝聞と直接経験を区別し、既存Memoryとの重複や矛盾を確認します
- 単純追加より、意味を保った統合と簡潔化を優先します
- ID、時刻、所有者、保存済みという事実を生成しません
- ReviewOutput以外の説明文を返しません`;

export class LongTermReviewDeepAgentHarness implements ReviewHarness {
  constructor(private readonly invoker: ReviewAgentInvoker, private readonly maxRepairs = 1, private readonly maxSteps = 4) {}
  async review(input: ReviewInput, signal: AbortSignal): Promise<ReviewOutput> {
    const validatedInput = ReviewInputSchema.parse(input);
    let raw: unknown; let issues: unknown;
    for (let attempt = 0; attempt <= this.maxRepairs; attempt += 1) {
      try {
        const content = attempt === 0 ? JSON.stringify({ promptVersion: "long-term-review-v1-ja", input: validatedInput }) : JSON.stringify({ instruction: "元の入力に対するReviewOutputをSchemaへ適合させ、全Candidateを1回ずつ判断してください。", input: validatedInput, issues, invalidOutput: raw });
        const result = await this.invoker.invoke({ messages: [{ role: "user", content }] }, { signal, recursionLimit: this.maxSteps });
        raw = result.structuredResponse;
        const parsed = ReviewOutputSchema.safeParse(raw);
        if (parsed.success) return parsed.data;
        issues = parsed.error.issues.map(({ code, path, message }) => ({ code, path, message }));
      } catch (error) {
        if (signal.aborted) throw new DomainError("ABORTED", "Long-term Review was interrupted", { cause: error });
        throw new DomainError("EXTERNAL", "Long-term Review provider failed", { cause: error });
      }
    }
    throw new DomainError("VALIDATION", `Long-term Review returned invalid output: ${JSON.stringify(issues)}`);
  }
}

export function createOllamaLongTermReviewInvoker(config: { readonly baseUrl: string; readonly apiKey: string; readonly model: string }): ReviewAgentInvoker {
  const model = new ChatOllama({ model: config.model, baseUrl: config.baseUrl, headers: { Authorization: `Bearer ${config.apiKey}` }, checkOrPullModel: false });
  const agent = createDeepAgent({ model, tools: [], responseFormat: providerStrategy(ReviewOutputSchema), systemPrompt: longTermReviewSystemPrompt });
  return { invoke: async (input, options) => { const result = await agent.invoke({ messages: [...input.messages] }, options); return { structuredResponse: result.structuredResponse }; } };
}
