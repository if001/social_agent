---
created_at: 2026-10-29
status: created
type: feature
plan: []
requirements: [C-30, C-31, C-32, C-33, C-34, C-35, C-36, C-37, C-38, C-48, C-65, C-70, FR-48, FR-49, FR-50, FR-62, FR-63, NFR-14, NFR-16, AC-11, AC-18]
requires: agent
---

# 011 G1/G2の予測LoopとpredictionEvaluationを実装する

元計画：なし（[008](008-prediction-memory-update-docs.md)、[009](009-background-experience-store-and-retrieval.md)の後続）

## Background

G1/G2は応答後に次ターンのユーザー発話を予測し、前回予測と観測の誤差を1ターン遅れで評価する。predictionEvaluationはMeaning / Feelingではなく、MainAgentのappraisal入力である。現行AgentRuntimeは応答と単一AgentHarnessの実行だけを持ち、応答後の追加callと予測の永続化を持たない。

## Dependencies

- 008
- 009

## Scope

- G1/G2のPrediction Context、Prediction Evaluation、Prediction RecordのZod契約とtableを追加する。
- 応答commit後にG1/G2を同期実行する追加のLLM callを実装する。
- G1/G2は1 callで、予測候補、predictionEvaluations、observationCandidates、remember（MemoryIntent）、G3起動判断を返す。
- G1/G2はFeelingを出力しない。
- 1ターン遅れのPrediction ContextをMainAgentへ渡す。
- G1/G2のdeadline、最大試行回数、call予算、失敗時のスキップを実装する。
- predictionEvaluationからRecentExperienceのeffectへ投影する。
- Context budgetとAgent所有権を検証する。

## Out of scope

- MemoryWriteServiceのcreate/update/no-op（012）。
- memory-update EventのHandler（013）。
- G3 DeepAgent（014）。
- Reflectionの部分成功（015）。

## Implementation notes

- G1/G2はMainAgentとは別のLLM callであり、MainAgentの出力Schemaを変更しない。
- 予測候補は`candidateIndex`で参照し、意味タグやpredictionKeyを使わない。
- `predictionContext`は前回予測、誤差評価、G3要約とmemoryIntents、RecentExperienceのeffect、memoryCandidatesを持つ。
- G1/G2の失敗は応答を巻き戻さず、次のuser-messageは前回予測なしとして継続する。
- `prediction_records`と`prediction_evaluations`はEvent/Runで検索できるようにする。
- 既存`AgentCoreInputSchema`はstrictのまま、`predictionContext`を追加する。

## Acceptance criteria

- [ ] AC-11：G1/G2の予測、1ターン遅れ、Feeling非出力をContract/System testで確認する。
- [ ] AC-18：predictionContextの所有権とContext budget、旧後処理ではないこと、call予算を確認する。
- [ ] G1/G2は応答後に1 callで実行される。
- [ ] 予測候補、predictionEvaluations、observations、remember、G3起動判断が保存される。
- [ ] G1/G2の失敗で応答や既存Memoryが巻き戻らない。
- [ ] `predictionContext`が次のMainAgentへ1ターン遅れで渡る。

## Tests

- FR-48, FR-49：`tests/contract/prediction-contracts.test.ts`で予測候補、predictionEvaluations、remember、G3判断のSchemaを検証する。
- FR-50：`tests/contract/prediction-contracts.test.ts`でFeelingを出力しないことを検証する。
- FR-48, FR-63：`tests/system/prediction-loop.test.ts`で応答後call、1ターン遅れ、deadline、失敗時継続を検証する。
- FR-62, NFR-14：`tests/unit/memory-context.test.ts`でpredictionContextの所有権とbudgetを検証する。
- AC-11, AC-18：上記のtestを通す。

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| src/domain/contracts.ts | PredictionEvaluation、PredictionContext、MemoryIntent、observationCandidates | 追加する |
| src/infrastructure/persistence/schema.ts | prediction_records、prediction_evaluations | 追加する |
| src/application/agent-runtime.ts | 応答後G1/G2、失敗時スキップ | 更新する |
| src/application/context-builder.ts | predictionContextのbudget | 更新する |
| src/infrastructure/persistence/postgres-agent-context-loader.ts | Prediction Contextの読み込み | 更新する |
| src/infrastructure/agent/ | G1/G2用structured output | 追加する |
| src/bootstrap/bot-composition.ts | G1/G2 harnessの配線 | 更新する |
| tests/contract, tests/system, tests/unit | 追加設計のtest | 追加する |
