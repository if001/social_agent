---
created_at: 2026-10-11
status: done
---

# 151: motive-review対象MotiveをContextへ必ず選択する

優先度: P0

## Background

[敵対再レビュー](../note/adversarial-rereview-2026-10-11.md)の「指摘4」への対応。先頭3件のsliceでは4件目以降の期限到来MotiveがContextから落ち、SchedulerのtargetIdとモデル入力が接続しない。

## Scope

- targetId一致を最優先し、期限超過、更新時刻等の安定した順位でMotiveを選ぶ。
- Context予算内で対象のdescription、goal、progress、根拠を保持する。
- 対象が削除済み・解決済み・他Agentの場合の処理を定義する。

## Out of scope

- Schedulerの周期変更、Motive件数の無制限増加。

## Implementation notes

- context-builder.tsとmotive-review Eventの契約を照合する。固定時刻でdueを判定し、存在しない重要度フィールドの追加を前提にしない。
- 対象が見つからない場合は別Motiveを対象として扱わず、診断可能にする。

## Acceptance criteria

- 配列4件目以降の対象もContextへ入る。
- 同順位時の順序が決定的で、対象を保持したまま既存Context予算を満たす。
- Scheduler EventからContextへの結合経路と対象不在の挙動が検証される。

## Tests

- 対象が4件目以降、複数due、同時刻、対象不在、他Agent、予算圧迫のテスト。
- 関連unit/system test、typecheck、lint。

## Dependencies

- なし。既存実装を起点に着手可能。

## Source plan

- [敵対再レビュー（2026-10-11）: 指摘4](../note/adversarial-rereview-2026-10-11.md)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
