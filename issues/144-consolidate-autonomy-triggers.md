---
created_at: 2026-10-11
status: done
---

# 144: 状態見直しとMemory想起を自律評価triggerへ統合する

## Background

[敵対レビューの不要コンポーネント5・6](../note/adversarial-review-2026-10-11.md)では、Coreを通らないstate-review専用scheduleとmemory-recall専用scheduleが、自律判断と別の定期pipelineを形成していると指摘されている。[概念設計 §12・§19・§22](../spec/personal-agent-concept-design-restructured-v2.md)では、時間経過やMemory想起が現在状態を変え、必要に応じて次の行動へつながる。

## Scope

- state-reviewの時間減衰とmemory-recallをautonomy評価へ渡すtriggerとして統合する。
- triggerはObservationとして通常のfocus selectionへ入り、現在のEmotion、Mood、Motive、関連MemoryからAction要否を判断する。
- 固定結果をContinuityへ直接渡すstate-review経路を削除する。
- 重複する専用schedule、lease、設定、監視項目を整理する。
- 時間減衰だけが必要な場合は外部Actionなしでstate deltaを確定できるようにする。

## Out of scope

- 明示時刻のScheduled Taskの統合。
- Motiveの`nextConsiderAt`によるdue判定の実装。
- Memory retrieval/ranking自体の刷新。

## Implementation notes

- Memory想起が常に発話やToolを起こす固定規則にはしない。
- autonomy triggerの種類と根拠MemoryをRunへ記録し、診断可能にする。
- lease、Agent所有権、idempotency、deadlineの既存保証を維持する。
- 修正時はレビューと一次資料を参照し、名前だけを統合した複数pipelineを残さない。

## Acceptance criteria

- state-reviewとmemory-recallの独立した定期実行経路がなくなる。
- 時間経過と関連Memoryの想起が通常の自律decisionへ入力される。
- Action不要時にもEmotion/Mood/Motiveの妥当な時間変化を保存できる。
- triggerの種類、根拠、decision、state deltaを一つのRunとして追跡できる。

## Tests

- 時間減衰、Memory想起、両方が同時に発生するscheduler system test。
- Actionあり/なしのautonomy Runtime test。
- process再起動、lease競合、重複排除のintegration test。
- typecheck、lint。

## Dependencies

- 139
- 141

## Source plan

- [敵対レビュー: 不要コンポーネント5・6](../note/adversarial-review-2026-10-11.md#不要または過剰なコンポーネント)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
