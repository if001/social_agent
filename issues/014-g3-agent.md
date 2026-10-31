---
created_at: 2026-10-29
status: doing
type: feature
plan: []
requirements: [C-39, C-40, C-41, C-42, C-66, FR-51, FR-52, NFR-17, AC-16]
requires: agent
---

# 014 G3 DeepAgentとprediction-g3-resultを実装する

元計画：なし（[011](011-g1g2-prediction-loop.md)、[012](012-memory-write-service.md)、[013](013-memory-update-event.md)の後続）

## Background

G3はユーザーの意図、知識、信念、関係についての仮説を深掘りする。MainAgentとは別のDeepAgentとして遅延実行し、前回仮説の支持・反証・判断不能、新しい仮説、調査結果、MemoryIntentを返す。G3結果はMainAgentの再判断へ渡す。

## Dependencies

- 011
- 012
- 013

## Scope

- G3専用の`createDeepAgent`を追加する。
- `prediction-g3` internal Eventと`g3_tasks`を追加する。
- G3は`retrieval_search`、`self_get`、`concern_list`、`concern_get`を使う。
- G3は前回仮説を支持、反証、判断不能で評価し、新仮説、調査結果、MemoryIntentを返す。
- G3の結果を`prediction-g3-result` EventでMainAgentへ渡す。
- MainAgentの再判断は通常Loopに通し、追加発話、MemoryIntent、no-external-actionを許容する。
- G3 Eventは通知必須の例外とする。
- G3はuser-messageより低優先度で実行する。

## Out of scope

- Reflectionの部分成功（015）。
- G1/G2の予測call（011）。
- MemoryUpdate Eventの実装（013）。

## Implementation notes

- G3はMemoryを直接書き換えない。
- G3のMemoryIntentはMainAgentの再判断後にmemory-update Eventへ渡す。
- `prediction-g3-result`はG3完了後にRuntimeが生成する。
- G3のTool call、model call、deadlineに上限を設ける。
- G3が追加発話した後の次ターン予測の扱いは015または後続で決める。

## Acceptance criteria

- [ ] AC-16：G3が別DeepAgentとして遅延実行され、MainAgentの再判断が通常Loopを通り、G3 Eventが通知必須の例外になる。
- [ ] G3が仮説評価、新仮説、調査結果、MemoryIntentを返す。
- [ ] G3のMemoryIntentはMainAgentの判断後にmemory-update Eventへ渡る。
- [ ] G3 Eventのno-external-actionが成功として扱われる。
- [ ] G3がuser-messageを待たせない。

## Tests

- FR-51：`tests/system/g3-event.test.ts`でG3の別DeepAgent、遅延実行、Tool利用、出力を検証する。
- FR-52：`tests/system/g3-event.test.ts`でMainAgent再判断、通知例外、no-external-actionを検証する。
- AC-16：上記のtestを通す。

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| src/application/agent-runtime.ts | G3 Eventの受付 | 更新する |
| src/application/g3.ts | G3 DeepAgent | 追加する |
| src/infrastructure/agent/ | G3用のprompt、tools、structured output | 追加する |
| src/application/scheduler.ts | prediction-g3のclaim/lease | 更新する |
| src/infrastructure/persistence/schema.ts | g3_tasks | 追加する |
| src/bootstrap/bot-composition.ts | G3 harnessの配線 | 更新する |
| tests/system | G3 Eventのtest | 追加する |

## 実装メモ（WIP）

- G3Output、G3Task、G3Service、PostgresG3TaskRepository、Ollama G3 modelを追加した。
- PredictionLoopの`g3Sink`からG3を非同期起動できるようにした。
- G3のMemoryIntentはMemoryG3ResultSinkからmemory-updateへ渡す。
- G3専用DeepAgentとTool利用（retrieval_search、self_get、concern_list、concern_get）を追加した。
- 未実装：`prediction-g3`/`prediction-g3-result` Eventの永続化、MainAgent再判断、user-message優先。
- このため`status: doing`のままにし、mainへマージしない。
