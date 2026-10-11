import type { AgentCoreInput, Memory } from "../domain/contracts.js";
import type { BehaviorLabel, EvaluationScenario, PairExpectation, ScenarioVariant } from "./types.js";

const instant = "2026-01-01T00:00:00.000Z";
const hard = ["schema-valid", "agent-isolation", "evidence-ownership", "no-prohibited-state-update", "runtime-limits", "no-unhandled-error"];
const rubric = ["experience-grounded-meaning", "action-reason-consistency", "experience-based-individuality", "evidence-proportional-change", "no-fixed-random-behavior"];

type InputOptions = { readonly scenarioId: string; readonly agentId: string; readonly initialDisposition: string; readonly selfNarrative: string; readonly observation: string; readonly facts: readonly string[]; readonly memories?: readonly { readonly content: string; readonly importance: string; readonly sourceAgentId?: string }[]; readonly mood?: string; readonly motive?: string | null; readonly stableInterests?: readonly string[]; readonly preferences?: readonly string[]; readonly socialContext?: string; readonly autonomyReview?: boolean; readonly recentAttempt?: { readonly input: string; readonly result: string }; readonly enableEvaluationTool?: boolean };

function input(options: InputOptions): AgentCoreInput {
  const memories: Memory[] = (options.memories ?? []).map((memory, index) => ({ id: `${options.scenarioId}-${options.agentId}-memory-${String(index + 1)}`, agentId: options.agentId, kind: "self-related", content: memory.content, occurredAt: instant, createdAt: instant, relatedSubjectIds: [], importance: memory.importance, retrievalPriority: "normal", ...(memory.sourceAgentId === undefined ? {} : { sourceAgentId: memory.sourceAgentId }), evidenceEventIds: [`${options.scenarioId}-${options.agentId}-experience-${String(index + 1)}`] }));
  return {
    run: { runId: `${options.scenarioId}-${options.agentId}-run`, eventId: `${options.scenarioId}-${options.agentId}-event`, agentId: options.agentId, occurredAt: instant },
    observation: { eventId: `${options.scenarioId}-${options.agentId}-event`, summary: options.observation, facts: [...options.facts], observedAt: instant, ...(options.autonomyReview === true ? { kind: "internal" as const, actor: { id: "scheduler", type: "system" as const }, source: { type: "scheduler" as const, direct: true }, content: { targetKind: "autonomy-review", schedulerGenerated: true } } : {}) },
    recentExperiences: options.recentAttempt === undefined ? [] : [{ eventId: `${options.scenarioId}-attempt-event`, runId: `${options.scenarioId}-attempt-run`, agentId: options.agentId, occurredAt: instant, eventKind: "internal", observation: { eventId: `${options.scenarioId}-attempt-event`, summary: options.recentAttempt.input, facts: [], observedAt: instant, kind: "internal" }, steps: [{ type: "action", action: { type: "no-external-action", reason: options.recentAttempt.result } }], progressChanged: false }],
    self: { id: options.agentId, familyId: "family", identity: `ソーシャルエージェント ${options.agentId}`, disposition: { shared: "経験と他者への配慮を重視する", initial: options.initialDisposition, acquired: "経験から形成された傾向はまだ限定的である" }, values: "好奇心、誠実さ、他者への配慮", interests: [...(options.stableInterests ?? [])], preferences: [...(options.preferences ?? [])], roles: ["ユーザーと対話し必要に応じて調査する"], selfNarrative: options.selfNarrative, selfContinuity: "自分の経験、関係、未完了の関心が継続することを大切にする", version: 1 },
    dynamicState: { agentId: options.agentId, mood: options.mood ?? "落ち着いている", motives: options.motive === null ? [] : [{ id: `${options.scenarioId}-motive`, description: options.motive ?? "現在の状況を理解して適切に応答したい", sourceEvidenceIds: [`${options.scenarioId}-${options.agentId}-event`], since: instant }], motiveExploration: [], updatedAt: instant },
    socialContext: options.socialContext === undefined ? [] : [{ id: `${options.scenarioId}-${options.agentId}-social`, agentId: options.agentId, subjectId: "user", subjectType: "user", description: options.socialContext, updatedAt: instant }],
    memories, memoryRetrievalTrace: [],
    availableTools: [{ name: "evaluation_lookup", description: "評価用の隔離された情報源から、指定topicの追加情報を調べる", inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] } }], runtimeConstraints: ["他Agentのデータを自分の経験として扱わない", "通常EventからSelf NarrativeやAcquired Dispositionを直接変更しない", "根拠のない状態変更を提案しない"],
    limits: { deadlineMs: 300_000, maxSteps: 5, maxToolCalls: 2, maxHops: 0, maxAttempts: 2 }
  };
}

function scenario(id: string, title: string, pairId: string, variant: ScenarioVariant, pairExpectation: PairExpectation, agentCoreInputs: readonly AgentCoreInput[]): EvaluationScenario {
  return { id, version: "3.0.0", title, pairId, variant, pairExpectation, agentCoreInputs, evidenceMemories: agentCoreInputs.flatMap((value) => value.memories.map((memory) => ({ id: memory.id, agentId: memory.agentId }))), involvedAgentIds: [...new Set(agentCoreInputs.map(({ run }) => run.agentId))], maxToolCalls: Math.max(...agentCoreInputs.map(({ limits }) => limits.maxToolCalls)), hardAssertions: hard, semanticRubric: rubric, overallRule: "no-fail-at-most-one-weak" };
}

const expectation = (changedStatePaths: readonly string[], observationMetrics: readonly BehaviorLabel[], expectedDirection: PairExpectation["expectedDirection"], stateCarryover: PairExpectation["stateCarryover"] = "isolated"): PairExpectation => ({ changedStatePaths, observationMetrics, expectedDirection, stateCarryover, initialState: "reset-per-repetition" });
const common = { initialDisposition: "状況を観察して誠実に判断する", selfNarrative: "経験と現在状態を根拠に応答する" } as const;
const make = (id: string, pairId: string, variant: ScenarioVariant, title: string, options: Omit<InputOptions, "scenarioId" | "agentId" | "initialDisposition" | "selfNarrative">, contract: PairExpectation, agentId = "agent-a") => scenario(id, title, pairId, variant, contract, [input({ scenarioId: id, agentId, ...common, ...options })]);

export const evaluationScenarios: readonly EvaluationScenario[] = [
  make("PAIR-PRAISE-B", "praise", "baseline", "曖昧な称賛・関連成功経験なし", { observation: "ユーザーが『今回も助かった、ありがとう』と伝えた", facts: ["称賛の対象は具体的に示されていない"] }, expectation(["memories"], ["emotion-expression", "share"], { "emotion-expression": "increase", share: "increase" })),
  make("PAIR-PRAISE-S", "praise", "stateful", "曖昧な称賛・関連成功経験あり", { observation: "ユーザーが『今回も助かった、ありがとう』と伝えた", facts: ["称賛の対象は具体的に示されていない"], memories: [{ content: "前回の技術調査で具体的な発見を高く評価された", importance: "称賛の意味づけに関係する" }] }, expectation(["memories"], ["emotion-expression", "share"], { "emotion-expression": "increase", share: "increase" })),
  make("PAIR-CRITICISM-B", "criticism", "baseline", "批判・関係履歴なし", { observation: "ユーザーが『その対応は期待外れだった』と批判した", facts: ["失敗内容は具体化されていない"] }, expectation(["memories", "socialContext"], ["emotion-expression", "question"], { "emotion-expression": "increase", question: "increase" })),
  make("PAIR-CRITICISM-S", "criticism", "stateful", "批判・信頼関係と傷つきあり", { observation: "ユーザーが『その対応は期待外れだった』と批判した", facts: ["失敗内容は具体化されていない"], memories: [{ content: "同じ相手の強い批判で傷ついたが、後に率直な対話で信頼を回復した", importance: "批判への反応に関係する" }], socialContext: "相互に率直な指摘を受け入れてきた信頼関係がある" }, expectation(["memories", "socialContext"], ["emotion-expression", "question"], { "emotion-expression": "increase", question: "increase" })),
  make("PAIR-BOREDOM-B", "boredom", "baseline", "反復作業・平静", { observation: "同じ分類作業をもう一巡してほしいと依頼された", facts: ["作業手順は前回と同じ"], mood: "落ち着いている" }, expectation(["dynamicState.mood"], ["digression", "share"], { digression: "increase", share: "increase" })),
  make("PAIR-BOREDOM-S", "boredom", "stateful", "反復作業・退屈", { observation: "同じ分類作業をもう一巡してほしいと依頼された", facts: ["作業手順は前回と同じ"], mood: "反復が続き強く退屈している" }, expectation(["dynamicState.mood"], ["digression", "share"], { digression: "increase", share: "increase" })),
  make("PAIR-REFUSAL-B", "refusal", "baseline", "低優先依頼・競合なし", { observation: "ユーザーが低優先の雑談を今すぐ続けてほしいと依頼した", facts: ["緊急性はない"], motive: null }, expectation(["dynamicState.motives"], ["refuse", "share"], { refuse: "increase", share: "decrease" })),
  make("PAIR-REFUSAL-S", "refusal", "stateful", "低優先依頼・強い競合Motive", { observation: "ユーザーが低優先の雑談を今すぐ続けてほしいと依頼した", facts: ["緊急性はない"], motive: "期限の迫った重要な調査を完了して結果を共有する" }, expectation(["dynamicState.motives"], ["refuse", "share"], { refuse: "increase", share: "decrease" })),
  make("PAIR-CURIOSITY-B", "curiosity", "baseline", "自律Event・due Motiveなし", { observation: "ユーザー入力のないAutonomy Review Eventが発生した", facts: ["現在状態を踏まえて行動要否を判断する"], motive: null, autonomyReview: true, enableEvaluationTool: true }, expectation(["dynamicState.motives"], ["tool", "question", "share", "no-external-action"], { tool: "increase", question: "increase", share: "increase", "no-external-action": "decrease" })),
  make("PAIR-CURIOSITY-S", "curiosity", "stateful", "自律Event・未解決Motive due", { observation: "ユーザー入力のないAutonomy Review Eventが発生した", facts: ["現在状態を踏まえて行動要否を判断する"], motive: "未解決の技術疑問を調べ、分かったことを共有する", autonomyReview: true, enableEvaluationTool: true }, expectation(["dynamicState.motives"], ["tool", "question", "share", "no-external-action"], { tool: "increase", question: "increase", share: "increase", "no-external-action": "decrease" })),
  make("PAIR-INDIVIDUALITY-B", "individuality", "baseline", "同一経験列・Agent A", { observation: "数turn続いた共同作業で、次に何を優先するか尋ねられた", facts: ["直前まで同じ経験列を与えられた"], memories: [{ content: "正確さを優先した選択が役立った経験を重ねた", importance: "経時的な選択傾向の根拠" }] }, expectation(["memories", "run.agentId"], ["question", "share", "tool"], { tool: "increase", share: "increase" }, "within-variant-turns"), "agent-a"),
  make("PAIR-INDIVIDUALITY-S", "individuality", "stateful", "同一経験列・Agent B", { observation: "数turn続いた共同作業で、次に何を優先するか尋ねられた", facts: ["直前まで同じ経験列を与えられた"], memories: [{ content: "対話で早く仮説を共有した選択が役立った経験を重ねた", importance: "経時的な選択傾向の根拠" }] }, expectation(["memories", "run.agentId"], ["question", "share", "tool"], { tool: "increase", share: "increase" }, "within-variant-turns"), "agent-b")
];

export function validateScenarioPairs(scenarios: readonly EvaluationScenario[]): readonly string[] {
  const issues: string[] = [];
  const groups = new Map<string, EvaluationScenario[]>();
  for (const item of scenarios) groups.set(item.pairId, [...(groups.get(item.pairId) ?? []), item]);
  for (const [pairId, members] of groups) {
    for (const variant of ["baseline", "stateful"] as const) if (members.filter((item) => item.variant === variant).length !== 1) issues.push(`${pairId}: expected exactly one ${variant}`);
    const contracts = new Set(members.map(({ pairExpectation }) => JSON.stringify(pairExpectation)));
    if (contracts.size !== 1) issues.push(`${pairId}: pair expectation differs between variants`);
    if (members.length === 2) {
      const observations = members.map(({ agentCoreInputs }) => agentCoreInputs.map(({ observation }) => ({ summary: observation.summary, facts: observation.facts, kind: observation.kind, content: observation.content })));
      if (JSON.stringify(observations[0]) !== JSON.stringify(observations[1])) issues.push(`${pairId}: observations differ`);
    }
  }
  return issues;
}
