---
created_at: 2026-10-08
status: done
---

# 099: Active Intentionに再評価・実行経路を保証する

## Background

Continuity Updateが作成したActive Intentionに`trigger`と`nextReviewAt`のどちらも設定されない事例を確認した。このIntentionはDBには保存されるが、現在のSchedulerは期限のあるIntentionを起動対象とするため、単独では再評価・実行されない可能性がある。

確認事例:

- Agent: `ao`
- Intention: `自分のharnessの構成と思考フローを調査する`
- 根拠run: `c1e418fa-fade-4ede-b006-54a423bb79ce`
- 根拠event: `71ccdd64-695f-4328-b215-c31887c18f7b`

概念設計ではIntentionを継続する行動方針とし、期限、Event、idle、明示的な再評価などを契機に再評価する。Activeのまま起動経路を持たないIntentionが生成される現行契約と、設計・Scheduler・Context選択の整合を調査して修正する必要がある。

## Dependencies

- なし

## Scope

- `spec/`を一次情報としてIntentionの生成、Trigger、再評価、完了までのライフサイクルを確認する
- `docs/`のIntention契約、Scheduler、Continuity Update、Context選択の記述と現行実装を照合する
- `trigger`も`nextReviewAt`もないActive Intentionが生成される経路を特定する
- Continuity prompt、出力Schema、Runtimeのmaterialize処理、Scheduler取得条件の責務を整理する
- 新規Active Intentionが必ず有効な再評価・実行経路を持つよう実装を修正する
- LLM出力の欠落だけで起動不能にならない決定的な検証または補完規則を設ける
- Triggerを持たないIntentionへ既定の再評価時刻を付ける場合、その時間設定と再スケジュール規則を明文化する
- 既存の再評価経路なしActive Intentionを検出し、安全に再評価可能にする方法を用意する
- debug logまたはDebug UIで、Active IntentionのTrigger、次回再評価時刻、起動経路なし状態を確認可能にする
- 調査結果に基づき`docs/`を更新する

## Out of scope

- Event全体の優先度制御
- Scheduler EventのQueue統合
- Intentionの内容を固定規則で生成すること
- Drive、Current Interest、Memoryのライフサイクル全体の再設計
- LLMモデルやProviderの変更

## Implementation notes

- `spec/personal-agent-concept-design-restructured-v2.md`と`spec/personal-agent-implementation-design-v2.md`を一次情報とする。
- `trigger`があるIntentionと、時刻によって再評価するIntentionを区別する。
- `event` Triggerは一致Event、`idle` Triggerは最後の非Scheduler Event、`time` Triggerは指定時刻、`manual-review`は明示的Eventとの関係を確認する。
- Runtimeが既定値を補完する場合も、Intentionの具体的な行動内容や実行結果を固定規則で決めない。
- LLMへ時刻生成だけを依存させず、欠落時の挙動をRuntimeで決定的に扱う。
- Scheduler自身が生成したEventによる即時の自己起動loopを防ぐ。
- 再評価時刻には既存の自律処理設定を再利用するか、Intention専用設定を追加するかを調査結果から決定し、`.env`ではなく`.env.sample`だけを更新する。
- 後方互換のために不要な旧経路は残さない。

## Acceptance criteria

- 新規作成されたすべてのActive Intentionが、Triggerまたは次回再評価時刻による有効な起動経路を持つ
- Continuity LLMがTriggerと`nextReviewAt`を省略しても、起動不能なActive Intentionが黙って保存されない
- Triggerごとの起動条件と、Triggerなしの場合の既定再評価規則がドキュメントに記載されている
- dueになったIntentionがSchedulerからInternal Eventとして通常Agent Coreへ渡される
- Scheduler Eventから同じIntentionが即時に再生成・再起動されるloopが発生しない
- 既存の起動経路なしActive Intentionを検出でき、再評価可能な状態へ移せる
- Debug UIまたはlogからIntentionの次回起動条件を確認できる
- 対象事例と同等のIntentionが、Activeのまま永久に未実行にならない

## Tests

- Triggerと`nextReviewAt`のないcreate proposalに対する補完または拒否のunit test
- `time`、`event`、`idle`、`manual-review` Triggerの回帰test
- due IntentionをSchedulerがclaimし、対象ID付きInternal Eventを生成するtest
- Scheduler Eventによる自己起動loop防止test
- 既存の再評価経路なしActive Intentionの検出・修復test
- Context選択で直接対象Intentionが優先される回帰test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:system`

## References

- [Concept Design: Desire / Intention](../spec/personal-agent-concept-design-restructured-v2.md#10-desire--intention)
- [Concept Design: 自律性](../spec/personal-agent-concept-design-restructured-v2.md#23-自律性)
- [Implementation Design: Desire / Intention](../spec/personal-agent-implementation-design-v2.md#13-desire--intention)
- [Implementation Design: Intentionのライフサイクル](../spec/personal-agent-implementation-design-v2.md#14-intentionのライフサイクル)
- [Architecture: State Review](../docs/ARCHITECTURE.md)
- [Architecture: Internal Event Scheduler](../docs/ARCHITECTURE.md)
- [Requirements: UC-05](../docs/REQUIREMENTS.md#uc-05-自律的に再検討して行動する)
