---
created_at: 2026-10-10
status: created
---

# 111: Drive・Current Interest・Actionの自律フローを再接続する

## Background

直近12時間の自律Runでは59件中41件が失敗し、成功18件もすべて`no-external-action`だった。`autonomy-review`と`persistent-drive`が同じ動機を重複処理し、Current Interestを失った広いDriveが無限定なTool探索を始め、Timeoutした試行は状態更新へ反映されない。新しいPlannerを追加せず、既存のDrive、Current Interest、Emotion、Mood、Preference、ObservationからActionを選ぶ流れを整える。

## Dependencies

- Issue 107
- Issue 108
- Issue 109
- Issue 110

## Scope

- DriveとCurrent InterestがActionへ直接影響するInteraction promptと契約へ統一する
- Active Driveに関係するCurrent Interestを終了する場合、Drive終了または現在実行可能なCurrent Interestへのreframe / createを同じ更新で行う整合条件を設ける
- Current Interestがある場合、Action / Toolがfocusと当面のgoalへ対応するよう検証する
- Current InterestがなくActive Driveがある場合、今回の小さなActionを実行し、継続価値が生じたらPost-processでCurrent Interestを作る
- 1 Eventで扱うfocusとgoalを一つに限定し、探索を別テーマへ拡張しない
- `autonomy-review`と`persistent-drive`が同じ動機を重複処理しない起動経路へ統合する
- Timeout / Provider failureでもTool試行、失敗、経過時間をOutcomeとして保存する
- 失敗Outcomeを反復防止、Current Interest停滞、cooldown、次回判断へ反映する
- Timeout時は短いretryでRun stormを作らず、通常review周期または指数backoffへ戻す
- 自律的な質問や共有では「ユーザー不在」を外部Actionの禁止理由にしない
- Recent Experiences、Debug UI、評価scenarioを更新する

## Out of scope

- Autonomy Plannerという新しい状態またはLLMフロー
- DesireまたはIntentionの再導入
- DriveとCurrent Interestの単一Schemaへの統合
- Scheduler間隔の固定値変更だけで問題を回避すること

## Implementation notes

- 自律行動は`Drive / Current Interest + Observation + Self / Mood / Emotion / Preference → Action`とする。
- Driveは行動理由、Current Interestは探索対象と当面の満足点を提供する。
- Deep AgentのTool loopは利用するが、今回のfocus、goal、Tool回数、残り時間を越えて探索を広げない。
- 成否に関係なくAttemptを記録し、同じ探索を新しい経験なしに反復しない。

## Acceptance criteria

- Current Interestのfocusとgoalが自律Actionの対象と完了範囲へ反映される
- Active Driveだけが残った場合も有界なActionまたはDrive終了へ進む
- Current Interestを失って広いDriveだけが反復探索する状態を防げる
- autonomy-reviewとpersistent-driveが同じ目的で二重にDeep Agentを起動しない
- 失敗Runの試行が次回判断とcooldownへ反映される
- 1時間設定時に失敗retryで1時間あたり多数のRunが発生しない
- 自律的な質問または有用な共有を外部へ配送できる

## Tests

- Drive / Current Interest → Action contract test
- Current Interest resolve/drop時のDrive整合test
- focus外Tool探索の拒否test
- 重複Schedule統合test
- Timeout / Provider failure outcome test
- 反復Tool抑制とcooldown test
- Scheduler retry密度test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:system`
- DB integration test
- 1 autonomy scenario × 1 live run

## References

- [Issue 107](./107-document-motivation-and-scheduled-task-model.md)
- [Issue 108](./108-remove-desire-from-interaction-state.md)
- [Issue 109](./109-add-tool-created-scheduled-tasks.md)
- [Issue 110](./110-remove-intention-state.md)
- [Agent Motivation Model](../docs/AGENT_MOTIVATION_MODEL.md)
