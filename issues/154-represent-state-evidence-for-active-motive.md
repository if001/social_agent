---
created_at: 2026-10-11
status: done
---

# 154: activeMotiveの根拠にSelf・Mood・関係性・Motiveを表現する

優先度: P1

## Background

[敵対再レビュー](../note/adversarial-rereview-2026-10-11.md)の「指摘6」への対応。promptで参照する状態と許可evidence IDが一致せず、状態由来の動機を汎用Event IDへ置き換えるしかない。

## Scope

- activeMotiveの状態根拠を識別できる参照契約を定義する。
- Self version、Mood、Social Context、保存Motive、current EmotionをContextと検証へ接続する。
- prompt、schema、所有者検証、監査表示を同じ契約へ揃える。

## Out of scope

- 一般のMemory根拠検証の無効化、無関係な他Agent状態の参照許可。

## Implementation notes

- 型付き参照または安定IDとversionを用い、実際に渡した状態だけを許可する。Mood等に既存IDがなければsnapshot参照を定義する。
- activeMotiveの根拠と永続更新proposalの根拠の違いを保ち、既存Event/Memory参照を破壊しない。

## Acceptance criteria

- 列挙した状態を根拠にしたactiveMotiveが検証を通る。
- 不明ID、別Agent、入力にないversionを拒否できる。
- artifactからどの状態が根拠かを復元できる。

## Tests

- 各状態参照の受理、不明参照・所有者違反の拒否、既存Event/Memory互換性テスト。
- 関連unit/evaluation test、typecheck、lint。

## Dependencies

- なし。既存実装を起点に着手可能。

## Source plan

- [敵対再レビュー（2026-10-11）: 指摘6](../note/adversarial-rereview-2026-10-11.md)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
