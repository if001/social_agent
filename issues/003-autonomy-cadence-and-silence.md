---
created_at: 2026-10-19
status: done
type: change
plan: []
requirements: [C-17, FR-19, FR-20, FR-21, FR-39, FR-45]
requires: agent
---

# 003 自律Eventの再開間隔を回帰テストで固定し、通知を通常会話の代替にしない

元計画：なし（会話起点）

## Background

`idle`の次回時刻は、現在`interval = autonomyReviewIntervalMs`として計算されるため、`no-external-action`や`notify-no-execution`を選んでも通常間隔で再開する（[scheduler.ts](../src/application/scheduler.ts#L54-L56)）。1日後のfallbackは`interval`が`null`または`undefined`のtargetKindにだけ適用され、`idle`には適用されない。したがって「idleで沈黙すると次回が1日後になる」という当初の前提は、現行実装には当てはまらない。

残る論点は、`notify-no-execution`がユーザーへ配送され、Action契約上は成功として扱われることである（[agent-runtime.ts](../src/application/agent-runtime.ts#L29)）。高頻度で話しかける方針では、通知だけのrunを通常会話の代替にすると、実質的な沈黙を選ぶ抜け道になる。このIssueではprompt上の通常経路を明確にし、Runtimeの成功条件そのものは変更しない。評価では`notify-no-execution`を`no-external-action`と同じbehavior labelにしているが、Runtimeの成功条件とは分かれている（[ollama-live.ts](../src/evaluation/ollama-live.ts#L45-L55)）。

## Dependencies

なし

## Scope

- `idle` + `no-external-action`と`idle` + `notify-no-execution`が、どちらも`autonomyReviewIntervalMs`後に再開することを回帰テストで固定する。schedulerのコード変更は行わない。
- system promptの自律Event節へ、`idle` / `concern-due`の通常経路は`respond`または`refuse`であり、`notify-no-execution`を通常会話の代替にしないこと、`no-external-action`を既定にしないことを追加する。
- `notify-no-execution`と`no-external-action`のAction schema descriptionへ、通常経路ではなく例外的な判断であることを追記する。
- 上記のprompt / schema description修正を、このIssue内で行う。
- 正の文書へ、`idle`の再開間隔はActionに依存しないこと、通知を通常会話の代替にしないことを反映する。

## Out of scope

- `scheduler.ts`の`next`計算の変更。`idle`は既にAction非依存で通常間隔を返す。
- `autonomyReviewIntervalMs`の既定値や運用値の変更。
- `notify-no-execution`の配送先をユーザーからowner専用channelへ変えること。
- `concern-due`と`external-change`の再スケジュール方針。
- 沈黙回数を数える新しい永続counterの追加。
- `idle`で`no-external-action`を型またはRuntimeで禁止すること。C-17の「今回は発話しない選択」を制限するため、必要なら上流承認を得た別Issueとする。
- ReflectionのbackoffやScheduled Taskのretry。

## Implementation notes

- `tests/unit/scheduler.test.ts`のsetupを`notify-no-execution`も扱えるようにし、`idle` + `no-external-action` / `notify-no-execution`の次回時刻が通常間隔になるtestを追加する。既存の「idle + no-external-actionで1分後」testは維持する。
- `deep-agent-prompt.ts`の自律Event節へ、通知を沈黙の代替にしないこと、`no-external-action`を既定にしないことを追加する。
- `contracts.ts`と`deep-agent-harness.ts`の`notify-no-execution` / `no-external-action` descriptionを更新する。
- `tests/unit/agent-prompts.test.ts`へ、通常経路と通知の扱いのprompt testを追加する。
- `docs/AGENT_MOTIVATION_MODEL.md`、`docs/REQUIREMENTS.md`、`docs/ARCHITECTURE.md`、`docs/TEST_STRATEGY.md`を更新する。
- `tests/system/internal-event.test.ts`、`tests/system/runtime-terminal.test.ts`への影響を確認する。既存の通知配送は変更しない。

## Acceptance criteria

- [x] AC-7：`idle` + `no-external-action`と`idle` + `notify-no-execution`が、どちらも`autonomyReviewIntervalMs`後に再開する。
- [x] promptが`idle` / `concern-due`の通常経路として`respond`または`refuse`を案内し、通知を通常会話の代替にしない。
- [x] `notify-no-execution`と`no-external-action`のAction descriptionが、通常経路ではなく例外的な判断であることを説明している。
- [x] schedulerのコードを変更していない。
- [x] 差分が正の文書に反映されている。
- [x] 上流への反映がすべて「反映済み」または「不要」になっている。
- [x] `spec-analyze change`でCRITICALとHIGHの指摘がない。

## Tests

- FR-45、AC-7：`idle` + `no-external-action`で次回が通常間隔になる。
- FR-45、AC-7：`idle` + `notify-no-execution`で次回が通常間隔になる。
- FR-45：promptが通知を沈黙の代替にせず、`no-external-action`を既定にしない。
- FR-19：通知Actionの配送と監査記録が維持される。
- FR-39：`concern-due`と`external-change`の`null`再スケジュールが変わらない。
- typecheck、lint、scheduler unit、関連system / evaluation test。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| ADDED | FR-45 | `idle`の再開間隔はActionに依存せず、promptが通知を通常会話の代替にしない | docs/REQUIREMENTS.md |
| ADDED | AC-7 | 沈黙判断・通知後も通常間隔で再開し、promptが通知を通常経路の代替にしない | docs/REQUIREMENTS.md |
| MODIFIED | FR-19 | `notify-no-execution`は実行対象を選ばなかった場合の運用通知であり、沈黙の代替にしない | docs/REQUIREMENTS.md |
| MODIFIED | FR-21 | `no-external-action`を`idle`の既定Actionにしない | docs/REQUIREMENTS.md |
| MODIFIED | FR-39 | 自律Eventの再開間隔はActionと独立する | docs/REQUIREMENTS.md |


## 影響範囲

検索した語：`no-external-action`、`notify-no-execution`、`autonomyReviewIntervalMs`、`next_due_at`、`COALESCE($2`、`idle`

| 場所 | 内容 | 対応 |
|---|---|---|
| src/application/scheduler.ts | `idle`の次回時刻計算 | 変更しない（既にAction非依存） |
| src/infrastructure/persistence/postgres-schedule-repository.ts | `null`を1日後に変換 | 変更しない |
| src/infrastructure/agent/deep-agent-prompt.ts | 自律Eventの沈黙・通知指示 | 更新する |
| src/domain/contracts.ts | Action description | 更新する |
| src/infrastructure/agent/deep-agent-harness.ts | モデル向けAction description | 更新する |
| src/application/agent-runtime.ts | 通知の配送 | 変更しない |
| src/evaluation/ollama-live.ts | behavior label | 影響を確認する |
| tests/unit/scheduler.test.ts | 次回間隔の回帰test | 追加する |
| tests/unit/agent-prompts.test.ts | prompt test | 追加する |
| tests/system/internal-event.test.ts | 自律Eventの再開 | 影響を確認する |
| tests/system/runtime-terminal.test.ts | 通知Action | 影響を確認する |
| tests/evaluation/evaluation-runner.test.ts | 評価集計 | 影響を確認する |
| docs/AGENT_MOTIVATION_MODEL.md | 自律性とAction契約 | 更新する |
| docs/REQUIREMENTS.md | FR-19、FR-21、FR-39、FR-45、AC-7 | 更新する |
| docs/ARCHITECTURE.md | Schedulerの再開間隔 | 更新する |
| docs/TEST_STRATEGY.md | 検証対応 | 更新する |
| spec/personal-agent-concept-design-restructured-v2.md | C-17 | 更新しない（Actionと沈黙の選択は既に許容） |
| spec/personal-agent-implementation-design-v2.md | §13、§24、§25 | 更新しない（再開間隔・通知の扱いは実装判断） |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md C-17 | 自律EventでTool利用と発話判断を独立させる。Action集合は変更しない | 不要 |
| spec/personal-agent-implementation-design-v2.md §24 | Internal Eventの再評価 | 不要 |
| spec/personal-agent-implementation-design-v2.md §25 | 自律Actionの契機 | 不要 |
| docs/AGENT_MOTIVATION_MODEL.md | 沈黙と通知の扱い、再開間隔 | 反映済み |
| docs/REQUIREMENTS.md | FR-19、FR-21、FR-39、FR-45、AC-7 | 反映済み |
| docs/ARCHITECTURE.md | Schedulerの再開間隔 | 反映済み |
| docs/TEST_STRATEGY.md | 検証対応 | 反映済み |

## 実装メモ

- `idle`の再開間隔は既存実装のままAction非依存で、`no-external-action` / `notify-no-execution`の後も`autonomyReviewIntervalMs`で再開することを回帰testで固定した。schedulerのコードは変更していない。
- promptの自律Event節へ、`respond` / `refuse`を通常経路とし、通知を発話の代替にせず、`no-external-action`を既定にしないことを追加した。
- `notify-no-execution` / `no-external-action`のAction descriptionを更新した。
- テスト: `tests/unit/scheduler.test.ts`、`tests/unit/agent-prompts.test.ts`。
- 正の文書`docs/AGENT_MOTIVATION_MODEL.md`、`docs/REQUIREMENTS.md`、`docs/ARCHITECTURE.md`、`docs/TEST_STRATEGY.md`を更新した。
- 検証: typecheck、lint、unit 150件、system 42件が通過。
- レビュー記録: [docs/work/reviews/2026-10-21-issue-003.md](../docs/work/reviews/2026-10-21-issue-003.md)
