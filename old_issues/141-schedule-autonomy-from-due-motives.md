---
created_at: 2026-10-11
status: done
---

# 141: Motiveの再検討時刻から自律Eventを前倒しする

## Background

[敵対レビューの重要な指摘10とP1-2・P1-3](../note/adversarial-review-2026-10-11.md)では、active Motiveをpromptで毎回強制する一方、持続Motiveが次の行動時刻を駆動せず、自律triggerが固定周期に留まると指摘されている。[概念設計 §8・§10・§19](../spec/personal-agent-concept-design-restructured-v2.md)では、現在したいことと時間変化が自律行動の起点になる。

## Scope

- 持続Motiveへ自然言語の再検討理由と`nextConsiderAt`を持たせる。
- 新しいMotive、強いEmotion、Toolで見つけた未解決点、退屈の蓄積、約束期限が再検討時刻を更新できるようにする。
- Schedulerは最も早いdue Motiveをleaseし、通常Runtimeへ自律Eventを投入する。
- Motiveの作成・更新・resolve/drop時に対応するscheduleを同期する。
- 「全EventでactiveMotiveを捏造する」prompt制約を外し、競合する状態から選択した結果を記録する。

## Out of scope

- 明示時刻のScheduled TaskをMotiveへ統合すること。
- urgencyの数値scoreや固定閾値による行動決定。
- 自律Eventで必ず外部発話させること。

## Implementation notes

- Scheduled Taskは約束の実行責務、Motive scheduleは再検討の契機として分離する。
- lease、idempotency、再試行、Agent所有権を既存Schedulerと同等に保つ。
- dueになったこと自体をTool使用や発話の固定ルールにしない。
- 修正時はレビューと一次資料を参照し、固定24時間の別scheduleを増やさない。

## Acceptance criteria

- Motive作成・更新により次の自律評価時刻が前倒しまたは再設定される。
- resolve/dropしたMotiveから自律Eventが発生しない。
- due Motiveがユーザー入力なしで通常のfocus selectionとdecisionを起動する。
- 同時実行しても同じdue Motiveを二重処理しない。

## Tests

- Motive lifecycleとschedule同期のunit/contract test。
- due、前倒し、延期、resolve/drop、process再起動のscheduler integration test。
- 未解決MotiveからToolまたは共有をモデルが選べるevaluation fixture。
- typecheck、lint。

## Dependencies

- 139
- 140

## Source plan

- [敵対レビュー: P1-2・P1-3](../note/adversarial-review-2026-10-11.md#p1-自律性を状態から駆動する)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
