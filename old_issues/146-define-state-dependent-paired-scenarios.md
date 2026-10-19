---
created_at: 2026-10-11
status: done
---

# 146: 状態差を比較する6組のpaired scenarioを定義する

優先度: P0

## Background

[敵対再レビュー](../note/adversarial-rereview-2026-10-11.md)の「指摘1・8、必須の対照評価」への対応。Issue 143はdoneだが、現行scenarioにpairId / variantがなく、状態差の比較条件が実装されていない。

## Scope

- 評価契約とfixtureにbaseline/statefulの対応と変える状態を定義する。
- praise、criticism、boredom、refusal、curiosity、individualityの6 pairを作る。
- individualityは同じ経験列を複数turn実行し、蓄積Memory差と同一Agentの経時変化を区別する。

## Out of scope

- 実モデルの反復実行、Runtime executor実装、行動を強制するprompt追加。

## Implementation notes

- 主な対象はsrc/evaluation/types.tsとscenarios.ts。時刻・Observation・設定を揃え、許容する状態差を明記する。
- 各pairの観測指標と期待する方向を実行前に定義する。fixtureの正解Actionをモデルへ渡さない。

## Acceptance criteria

- 6 pairすべてにpairIdとvariantがあり、片側欠落や重複を検出できる。
- 同一Observationと指定状態以外の同等性を検証できる。
- 複数turnのstate引継ぎ条件と初期化条件が明文化される。

## Tests

- pair完全性、入力同等性、状態差のfixture検証。
- pnpm test:evaluation、pnpm typecheck、pnpm lint。

## Dependencies

- なし。既存実装を起点に着手可能。

## Source plan

- [敵対再レビュー（2026-10-11）: 指摘1・8、必須の対照評価](../note/adversarial-rereview-2026-10-11.md)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
