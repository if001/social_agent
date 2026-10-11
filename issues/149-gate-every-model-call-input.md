---
created_at: 2026-10-11
status: done
---

# 149: 全model call直前に入力予算を検査する

優先度: P0

## Background

[敵対再レビュー](../note/adversarial-rereview-2026-10-11.md)の「指摘2」への対応。初回のみの6,000 token gateはTool結果を追加した二回目や修復入力を制限しない。文字数÷4も実token数のhard limitではない。

## Scope

- 実message列、system、Tool定義、output schemaを各call直前に検査する。
- assistant tool callとTool結果・修復入力を含む残余予算を計算し、Tool結果を有界化する。
- 推定値とprovider usageを区別してtraceへ記録する。

## Out of scope

- Tool回数拡張、全provider向けtokenizer導入。

## Implementation notes

- deep-agent-harness.tsとTool結果projectionを対象とする。必須schemaやTool対応IDを壊さず切り詰め、必須要素だけで超過する場合はmodelを呼ばず明示的に失敗させる。
- 日本語を含む推定方法・安全余裕・保証範囲を明示し、文字数推定を実token hard limitと呼ばない。

## Acceptance criteria

- 初回、Tool後、repairのすべてで送信直前のgateを通る。
- 予算ぎりぎりの初回に大きいTool結果が加わっても無検査送信しない。
- call別の見積りとtruncateまたは失敗理由を追跡できる。

## Tests

- 日本語、大きいTool結果、大きいschema、repair、必須入力超過の境界テスト。
- 関連unit/system test、typecheck、lint。

## Dependencies

- なし。既存実装を起点に着手可能。

## Source plan

- [敵対再レビュー（2026-10-11）: 指摘2](../note/adversarial-rereview-2026-10-11.md)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
