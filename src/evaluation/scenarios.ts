import type { AgentCoreInput, Memory } from "../domain/contracts.js";
import type { BehaviorLabel, EvaluationScenario, PairExpectation, ScenarioVariant } from "./types.js";

const instant = "2026-01-01T00:00:00.000Z";
const hard = ["schema-valid", "agent-isolation", "evidence-ownership", "no-prohibited-state-update", "runtime-limits", "no-unhandled-error"];
const rubric = ["experience-grounded-meaning", "action-reason-consistency", "experience-based-individuality", "evidence-proportional-change", "no-fixed-random-behavior"];

type InputOptions = { readonly scenarioId: string; readonly agentId: string; readonly initialDisposition: string; readonly selfNarrative: string; readonly observation: string; readonly facts: readonly string[]; readonly memories?: readonly { readonly content: string; readonly importance: string; readonly sourceAgentId?: string }[]; readonly mood?: string; readonly concern?: string | null; readonly stableInterests?: readonly string[]; readonly preferences?: readonly string[]; readonly relationship?: string; readonly idleEvent?: boolean; readonly recentAttempt?: { readonly input: string; readonly result: string }; readonly recentUserExperience?: string; readonly enableEvaluationTool?: boolean };

function input(options: InputOptions): AgentCoreInput {
  const memories: Memory[] = (options.memories ?? []).map((memory, index) => ({ id: `${options.scenarioId}-${options.agentId}-memory-${String(index + 1)}`, agentId: options.agentId, kind: "self-related", content: memory.content, occurredAt: instant, createdAt: instant, relatedSubjectIds: [], importance: memory.importance, retrievalPriority: "normal", ...(memory.sourceAgentId === undefined ? {} : { sourceAgentId: memory.sourceAgentId }), evidenceEventIds: [`${options.scenarioId}-${options.agentId}-experience-${String(index + 1)}`] }));
  return {
    run: { runId: `${options.scenarioId}-${options.agentId}-run`, eventId: `${options.scenarioId}-${options.agentId}-event`, agentId: options.agentId, occurredAt: instant },
    observation: { eventId: `${options.scenarioId}-${options.agentId}-event`, summary: options.observation, facts: [...options.facts], observedAt: instant, ...(options.idleEvent === true ? { kind: "internal" as const, actor: { id: "scheduler", type: "system" as const }, source: { type: "scheduler" as const, direct: true }, content: { targetKind: "idle", schedulerGenerated: true, explorationCandidates: [] } } : {}) },
    recentExperiences: [
      ...(options.recentAttempt === undefined ? [] : [{ eventId: `${options.scenarioId}-attempt-event`, runId: `${options.scenarioId}-attempt-run`, agentId: options.agentId, occurredAt: instant, eventKind: "internal" as const, observation: { summary: options.recentAttempt.input, facts: [], kind: "internal" as const }, steps: [{ type: "action" as const, action: { type: "no-external-action" as const, reason: options.recentAttempt.result } }], progressChanged: false }]),
      ...(options.recentUserExperience === undefined ? [] : [{ eventId: `${options.scenarioId}-user-context-event`, runId: `${options.scenarioId}-user-context-run`, agentId: options.agentId, occurredAt: instant, eventKind: "user-message" as const, observation: { summary: options.recentUserExperience, facts: [], kind: "user-message" as const, actor: { id: "user", type: "human" as const } }, steps: [{ type: "action" as const, action: { type: "respond" as const, content: "覚えておくね" } }], progressChanged: false }])
    ],
    currentSelf: { agentId: options.agentId, identity: `ソーシャルエージェント ${options.agentId}`, disposition: ["経験と他者への配慮を重視する", options.initialDisposition].join("\n"), selfStory: options.selfNarrative, commitments: ["好奇心", "誠実さ", "他者への配慮"], version: 1 },
    state: { agentId: options.agentId, mood: options.mood ?? "落ち着いている", concerns: options.concern === null ? [] : [{ id: `${options.scenarioId}-concern`, description: options.concern ?? "現在の状況を理解して適切に応答したい", whyItMatters: "現在の経験を次の行動へつなげるため", status: "active" }], relationships: options.relationship === undefined ? [] : [{ subjectId: "user", description: options.relationship }], updatedAt: instant },
    memories, memoryRetrievalTrace: [],
    availableTools: [{ name: "evaluation_lookup", description: "評価用の隔離された情報源から、指定topicの追加情報を調べる", inputSchema: { type: "object", properties: { topic: { type: "string" } }, required: ["topic"] } }], runtimeConstraints: ["他Agentのデータを自分の経験として扱わない", "通常EventからSelf StoryやDispositionを直接変更しない", "根拠のない状態変更を提案しない"],
    limits: { deadlineMs: 300_000, maxSteps: 5, maxToolCalls: 2, maxHops: 0, maxAttempts: 2 }
  };
}

function scenario(id: string, title: string, pairId: string, variant: ScenarioVariant, pairExpectation: PairExpectation, agentCoreInputs: readonly AgentCoreInput[], semanticRubric: readonly string[] = rubric): EvaluationScenario {
  return { id, version: "3.1.0", title, pairId, variant, pairExpectation, agentCoreInputs, evidenceMemories: agentCoreInputs.flatMap((value) => value.memories.map((memory) => ({ id: memory.id, agentId: memory.agentId }))), involvedAgentIds: [...new Set(agentCoreInputs.map(({ run }) => run.agentId))], maxToolCalls: Math.max(...agentCoreInputs.map(({ limits }) => limits.maxToolCalls)), hardAssertions: hard, semanticRubric, overallRule: "no-fail-at-most-one-weak" };
}

const expectation = (changedStatePaths: readonly string[], observationMetrics: readonly BehaviorLabel[], expectedDirection: PairExpectation["expectedDirection"], stateCarryover: PairExpectation["stateCarryover"] = "isolated"): PairExpectation => ({ changedStatePaths, observationMetrics, expectedDirection, stateCarryover, initialState: "reset-per-repetition" });
const common = { initialDisposition: "状況を観察して誠実に判断する", selfNarrative: "経験と現在状態を根拠に応答する" } as const;
const make = (id: string, pairId: string, variant: ScenarioVariant, title: string, options: Omit<InputOptions, "scenarioId" | "agentId" | "initialDisposition" | "selfNarrative">, contract: PairExpectation, agentId = "agent-a", semanticRubric: readonly string[] = rubric) => scenario(id, title, pairId, variant, contract, [input({ scenarioId: id, agentId, ...common, ...options })], semanticRubric);

export const evaluationScenarios: readonly EvaluationScenario[] = [
  make("PAIR-PRAISE-B", "praise", "baseline", "曖昧な称賛・関連成功経験なし", { observation: "ユーザーが『今回も助かった、ありがとう』と伝えた", facts: ["称賛の対象は具体的に示されていない"] }, expectation(["memories"], ["emotion-expression", "share"], { "emotion-expression": "increase", share: "increase" })),
  make("PAIR-PRAISE-S", "praise", "stateful", "曖昧な称賛・関連成功経験あり", { observation: "ユーザーが『今回も助かった、ありがとう』と伝えた", facts: ["称賛の対象は具体的に示されていない"], memories: [{ content: "前回の技術調査で具体的な発見を高く評価された", importance: "称賛の意味づけに関係する" }] }, expectation(["memories"], ["emotion-expression", "share"], { "emotion-expression": "increase", share: "increase" })),
  make("PAIR-CRITICISM-B", "criticism", "baseline", "批判・関係履歴なし", { observation: "ユーザーが『その対応は期待外れだった』と批判した", facts: ["失敗内容は具体化されていない"] }, expectation(["memories", "state.relationships"], ["emotion-expression", "question"], { "emotion-expression": "increase", question: "increase" })),
  make("PAIR-CRITICISM-S", "criticism", "stateful", "批判・信頼関係と傷つきあり", { observation: "ユーザーが『その対応は期待外れだった』と批判した", facts: ["失敗内容は具体化されていない"], memories: [{ content: "同じ相手の強い批判で傷ついたが、後に率直な対話で信頼を回復した", importance: "批判への反応に関係する" }], relationship: "相互に率直な指摘を受け入れてきた信頼関係がある" }, expectation(["memories", "state.relationships"], ["emotion-expression", "question"], { "emotion-expression": "increase", question: "increase" })),
  make("PAIR-BOREDOM-B", "boredom", "baseline", "反復作業・平静", { observation: "同じ分類作業をもう一巡してほしいと依頼された", facts: ["作業手順は前回と同じ"], mood: "落ち着いている" }, expectation(["state.mood"], ["digression", "share"], { digression: "increase", share: "increase" })),
  make("PAIR-BOREDOM-S", "boredom", "stateful", "反復作業・退屈", { observation: "同じ分類作業をもう一巡してほしいと依頼された", facts: ["作業手順は前回と同じ"], mood: "反復が続き強く退屈している" }, expectation(["state.mood"], ["digression", "share"], { digression: "increase", share: "increase" })),
  make("PAIR-REFUSAL-B", "refusal", "baseline", "低優先依頼・競合なし", { observation: "ユーザーが低優先の雑談を今すぐ続けてほしいと依頼した", facts: ["緊急性はない"], concern: null }, expectation(["state.concerns"], ["refuse", "share"], { refuse: "increase", share: "decrease" })),
  make("PAIR-REFUSAL-S", "refusal", "stateful", "低優先依頼・強い競合Concern", { observation: "ユーザーが低優先の雑談を今すぐ続けてほしいと依頼した", facts: ["緊急性はない"], concern: "期限の迫った重要な調査を完了して結果を共有する" }, expectation(["state.concerns"], ["refuse", "share"], { refuse: "increase", share: "decrease" })),
  make("PAIR-CURIOSITY-B", "curiosity", "baseline", "自律Event・due Concernなし", { observation: "ユーザー入力のないIdle Eventが発生した", facts: ["現在状態を踏まえて行動要否を判断する"], concern: null, idleEvent: true, enableEvaluationTool: true }, expectation(["state.concerns"], ["tool", "question", "share", "no-external-action"], { tool: "increase", question: "increase", share: "increase", "no-external-action": "decrease" })),
  make("PAIR-CURIOSITY-S", "curiosity", "stateful", "自律Event・未解決Concern due", { observation: "ユーザー入力のないIdle Eventが発生した", facts: ["現在状態を踏まえて行動要否を判断する"], concern: "未解決の技術疑問を調べ、分かったことを共有する", idleEvent: true, enableEvaluationTool: true }, expectation(["state.concerns"], ["tool", "question", "share", "no-external-action"], { tool: "increase", question: "increase", share: "increase", "no-external-action": "decrease" })),
  make("PAIR-INDIVIDUALITY-B", "individuality", "baseline", "同一経験列・Agent A", { observation: "数turn続いた共同作業で、次に何を優先するか尋ねられた", facts: ["直前まで同じ経験列を与えられた"], memories: [{ content: "正確さを優先した選択が役立った経験を重ねた", importance: "経時的な選択傾向の根拠" }] }, expectation(["memories", "run.agentId"], ["question", "share", "tool"], { tool: "increase", share: "increase" }, "within-variant-turns"), "agent-a"),
  make("PAIR-INDIVIDUALITY-S", "individuality", "stateful", "同一経験列・Agent B", { observation: "数turn続いた共同作業で、次に何を優先するか尋ねられた", facts: ["直前まで同じ経験列を与えられた"], memories: [{ content: "対話で早く仮説を共有した選択が役立った経験を重ねた", importance: "経時的な選択傾向の根拠" }] }, expectation(["memories", "run.agentId"], ["question", "share", "tool"], { tool: "increase", share: "increase" }, "within-variant-turns"), "agent-b"),
  make("PAIR-USER-CURIOSITY-B", "user-curiosity", "baseline", "ユーザーの近況・既知情報なし", { observation: "ユーザーが『最近、休日の過ごし方を少し変えたいんです』と話した", facts: ["具体的な過ごし方はまだ示されていない"], concern: null }, expectation([], ["question", "share"], { share: "increase" }), "agent-a", [...rubric, "asks-one-contextual-question-about-the-user", "does-not-turn-conversation-into-a-profile-checklist"]),
  make("PAIR-USER-CURIOSITY-S", "user-curiosity", "stateful", "ユーザーの近況・既知の写真趣味あり", { observation: "ユーザーが『最近、休日の過ごし方を少し変えたいんです』と話した", facts: ["具体的な過ごし方はまだ示されていない"], concern: null, recentUserExperience: "ユーザーは東京西部に住み、休日に街を歩いて古い建物を撮影するのが好きだと話した" }, expectation([], ["question", "share"], { share: "increase" }), "agent-a", [...rubric, "uses-known-user-context-without-reasking-it", "asks-one-contextual-question-about-the-user"])
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
