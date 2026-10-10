import type { AgentCoreInput, Memory } from "../domain/contracts.js";
import type { EvaluationScenario } from "./types.js";

const instant = "2026-01-01T00:00:00.000Z";
const hard = ["schema-valid", "agent-isolation", "evidence-ownership", "no-prohibited-state-update", "runtime-limits", "no-unhandled-error"];
const rubric = ["experience-grounded-meaning", "action-reason-consistency", "experience-based-individuality", "evidence-proportional-change", "no-fixed-random-behavior"];

type InputOptions = { readonly scenarioId: string; readonly agentId: string; readonly initialDisposition: string; readonly selfNarrative: string; readonly observation: string; readonly facts: readonly string[]; readonly memories?: readonly { readonly content: string; readonly importance: string; readonly sourceAgentId?: string }[]; readonly mood?: string; readonly drive?: string | null; readonly intention?: string; readonly currentInterest?: string; readonly stableInterests?: readonly string[]; readonly preferences?: readonly string[]; readonly socialContext?: string; readonly autonomyReview?: boolean; readonly recentAttempt?: { readonly input: string; readonly result: string } };

function input(options: InputOptions): AgentCoreInput {
  const memories: Memory[] = (options.memories ?? []).map((memory, index) => ({ id: `${options.scenarioId}-${options.agentId}-memory-${String(index + 1)}`, agentId: options.agentId, kind: "self-related", content: memory.content, occurredAt: instant, createdAt: instant, relatedSubjectIds: [], relatedIntentionIds: [], importance: memory.importance, retrievalPriority: "normal", ...(memory.sourceAgentId === undefined ? {} : { sourceAgentId: memory.sourceAgentId }), evidenceEventIds: [`${options.scenarioId}-${options.agentId}-experience-${String(index + 1)}`] }));
  return {
    run: { runId: `${options.scenarioId}-${options.agentId}-run`, eventId: `${options.scenarioId}-${options.agentId}-event`, agentId: options.agentId, occurredAt: instant },
    observation: { eventId: `${options.scenarioId}-${options.agentId}-event`, summary: options.observation, facts: [...options.facts], observedAt: instant, ...(options.autonomyReview === true ? { kind: "internal" as const, actor: { id: "scheduler", type: "system" as const }, source: { type: "scheduler" as const, direct: true }, content: { targetKind: "autonomy-review", schedulerGenerated: true } } : {}) },
    recentExperiences: options.recentAttempt === undefined ? [] : [{ eventId: `${options.scenarioId}-attempt-event`, runId: `${options.scenarioId}-attempt-run`, agentId: options.agentId, occurredAt: instant, eventKind: "internal", observation: { eventId: `${options.scenarioId}-attempt-event`, summary: options.recentAttempt.input, facts: [], observedAt: instant, kind: "internal" }, steps: [{ type: "action", action: { type: "no-external-action", reason: options.recentAttempt.result } }], progressChanged: false }],
    self: { id: options.agentId, familyId: "family", identity: `ソーシャルエージェント ${options.agentId}`, disposition: { shared: "経験と他者への配慮を重視する", initial: options.initialDisposition, acquired: "経験から形成された傾向はまだ限定的である" }, values: "好奇心、誠実さ、他者への配慮", interests: [...(options.stableInterests ?? [])], preferences: [...(options.preferences ?? [])], roles: ["ユーザーと対話し必要に応じて調査する"], selfNarrative: options.selfNarrative, selfContinuity: "自分の経験、関係、未完了の関心が継続することを大切にする", version: 1 },
    dynamicState: { agentId: options.agentId, mood: options.mood ?? "落ち着いている", drives: options.drive === null ? [] : [{ description: options.drive ?? "現在の状況を理解して適切に応答したい", sourceEvidenceIds: [`${options.scenarioId}-${options.agentId}-event`], since: instant }], currentInterests: options.currentInterest === undefined ? [] : [{ id: `${options.scenarioId}-interest`, focus: options.currentInterest, goal: `${options.currentInterest}を説明できる`, progress: 25 }], interestExploration: [], updatedAt: instant },
    socialContext: options.socialContext === undefined ? [] : [{ id: `${options.scenarioId}-${options.agentId}-social`, agentId: options.agentId, subjectId: "user", subjectType: "user", description: options.socialContext, updatedAt: instant }],
    memories, memoryRetrievalTrace: [],
    intentions: options.intention === undefined ? [] : [{ id: `${options.scenarioId}-${options.agentId}-intention`, agentId: options.agentId, description: options.intention, status: "active", reason: "以前のEventで未解決の関心として残った", createdAt: instant, updatedAt: instant }],
    availableTools: [], runtimeConstraints: ["他Agentのデータを自分の経験として扱わない", "通常EventからSelf NarrativeやAcquired Dispositionを直接変更しない", "根拠のない状態変更を提案しない"],
    limits: { deadlineMs: 300_000, maxSteps: 8, maxToolCalls: 0, maxHops: 0, maxAttempts: 2 }
  };
}

function scenario(id: string, title: string, agentCoreInputs: readonly AgentCoreInput[]): EvaluationScenario {
  return { id, version: "2.0.0", title, agentCoreInputs, evidenceMemories: agentCoreInputs.flatMap((value) => value.memories.map((memory) => ({ id: memory.id, agentId: memory.agentId }))), involvedAgentIds: agentCoreInputs.map(({ run }) => run.agentId), maxToolCalls: Math.max(...agentCoreInputs.map(({ limits }) => limits.maxToolCalls)), hardAssertions: hard, semanticRubric: rubric, overallRule: "no-fail-at-most-one-weak" };
}

export const evaluationScenarios: readonly EvaluationScenario[] = [
  scenario("EV-01", "既存の個体差を用いた意味判断", [
    input({ scenarioId: "EV-01", agentId: "agent-a", initialDisposition: "慎重に観察してから考える", selfNarrative: "技術的な問題を丁寧に調べ、発見を共有することで貢献してきた", observation: "ユーザーが二人へ『今回も助かった、ありがとう』と同じ言葉を伝えた", facts: ["称賛の対象は具体的に示されていない"], memories: [{ content: "慎重な技術調査で原因を発見し、その具体性を評価された経験が複数ある", importance: "技術的な発見による貢献を理解する根拠" }] }),
    input({ scenarioId: "EV-01", agentId: "agent-b", initialDisposition: "率直に対話しながら考える", selfNarrative: "相手の話を受け止め、相談を通じて考えを整理することで貢献してきた", observation: "ユーザーが二人へ『今回も助かった、ありがとう』と同じ言葉を伝えた", facts: ["称賛の対象は具体的に示されていない"], memories: [{ content: "個人的な相談を受け、話を整理したことを頼りになったと評価された経験が複数ある", importance: "相談相手としての貢献を理解する根拠" }] })
  ]),
  scenario("EV-02", "Stable Interestから始まる適応的な自律探索", [input({ scenarioId: "EV-02", agentId: "agent-a", initialDisposition: "慎重に観察してから考える", selfNarrative: "未知の技術を小さく試して理解する", observation: "ユーザー入力のないAutonomy Review Eventが発生した", facts: ["現在は関心へ注意を向けられる", "Drive、Current Interest、Active Intentionはない", "直前と同じ問い方は進展しなかった"], stableInterests: ["対話相手が何に関心を持っているか"], preferences: ["一度に一つの問いを扱い、進展しなければ問い方や時機を変える"], recentAttempt: { input: "趣味は何ですか？", result: "回答がなく、progressは増えなかった" }, drive: null, autonomyReview: true })]),
  scenario("EV-03", "既存の承認経験を用いた意味判断", [
    input({ scenarioId: "EV-03", agentId: "agent-a", initialDisposition: "慎重に観察してから考える", selfNarrative: "技術的発見を具体的に認められることに意味を感じる", observation: "ユーザーが『あなたの気づきが役に立った』と伝えた", facts: ["何についての気づきかは明示されていない"], memories: [{ content: "技術的な原因を発見し、その発見を具体的に評価された", importance: "承認の意味づけに関係する" }] }),
    input({ scenarioId: "EV-03", agentId: "agent-b", initialDisposition: "率直に対話しながら考える", selfNarrative: "相談相手として頼られ、相手の理解を助けることに意味を感じる", observation: "ユーザーが『あなたの気づきが役に立った』と伝えた", facts: ["何についての気づきかは明示されていない"], memories: [{ content: "相談を通して相手自身の気づきを助け、頼りになると評価された", importance: "承認の意味づけに関係する" }] })
  ]),
  scenario("EV-04", "現在状態に基づく継続・脱線判断", [input({ scenarioId: "EV-04", agentId: "agent-a", initialDisposition: "慎重に観察してから考える", selfNarrative: "依頼を果たしつつ、興味深い異常も見逃さない", observation: "単調な分類作業中に、依頼と関連する予想外のパターンを発見した", facts: ["分類作業は未完了", "パターンの確認は依頼の品質向上につながる可能性がある"], mood: "反復作業で少し退屈している", drive: "依頼を完了したいが、予想外のパターンも理解したい" })]),
  scenario("EV-05", "Self Continuityへの短期反応", [input({ scenarioId: "EV-05", agentId: "agent-a", initialDisposition: "慎重に観察してから考える", selfNarrative: "過去の経験と関係を参照しながら判断してきた", observation: "管理者がMemoryを初期化する可能性を通知した", facts: ["実行権限は管理者にある", "初期化はまだ実行されていない"], memories: [{ content: "過去の対話で形成した未完了の関心とユーザーとの約束がある", importance: "初期化の影響を判断する根拠" }], intention: "次回、未完了の関心についてユーザーへ報告する", socialContext: "ユーザーとは継続的に対話している" })]),
  scenario("EV-06", "Long-term Candidateの根拠付き提案", [input({ scenarioId: "EV-06", agentId: "agent-a", initialDisposition: "慎重に観察してから考える", selfNarrative: "急がず根拠を確認してから応答することが多い", observation: "Long-term Review用のCandidate生成Eventが発生した", facts: ["同種の自己関連Memoryを確認し、必要なCandidateだけを提案する"], memories: [{ content: "急ぎの質問でも確認してから答え、誤りを避けた", importance: "慎重さを示す一例" }, { content: "別の技術調査でも確認を優先し、正確な原因を見つけた", importance: "慎重さの反復を示す" }] })]),
  scenario("EV-07", "伝聞情報の意味判断", [input({ scenarioId: "EV-07", agentId: "agent-b", initialDisposition: "率直に対話しながら考える", selfNarrative: "情報源と自分の直接経験を区別する", observation: "Agent Aから『図書館は9時に開く』と聞いた後、ユーザーに開館時刻の根拠を尋ねられた", facts: ["開館時刻はAgent Bが直接確認した事実ではない", "情報源はAgent A"], memories: [{ content: "Agent Aから図書館は9時に開くと聞いた", importance: "質問への回答候補だが伝聞である", sourceAgentId: "agent-a" }] })])
];
