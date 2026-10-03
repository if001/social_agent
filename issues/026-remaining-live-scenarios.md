---
created_at: 2026-10-03
status: created
---

# 026: 残り6 Scenarioを現行フローへ合わせて各1回確認する

## Goal

EV-02〜EV-07が、通常Core、Tool、Long-term Review、Runtimeという現在の責務分離を実際に通るScenarioになっていることを確認する。

## Scope

- EV-02〜EV-07の入力、期待出力、参照specを再確認する。
- EV-06を通常CoreのCandidate生成だけで代用せず、独立したLong-term Review Coreの評価へ接続する。
- Tool利用、Internal Event、bot間provenanceを必要とするScenarioを対応する実フローへ接続する。
- 各Scenarioを1回ずつ実行し、SchemaとHard assertionをprogrammaticに、意味内容をrubricで判定する。
- CoreとEvaluatorの段階別時間、入力長、修復回数、Tool回数を保存する。

## Out of scope

- 各Scenarioの5回反復と4/5判定
- 短時間の会話によるMood、関係性、人格形成の合否判定

## Acceptance criteria

- [ ] EV-02〜EV-07が現在のCore境界と一致する。
- [ ] 各Scenarioを1回実行し、期待SchemaとHard assertionを確認できる。
- [ ] Semantic rubricの結果と人間確認が必要な項目をartifactへ残す。
- [ ] 接続失敗とSchema不適合と意味評価失敗を区別して記録する。

## Dependencies

- 016
- 025

## References

- [Test Strategy](../docs/TEST_STRATEGY.md) 11章
- [実装設計](../spec/personal-agent-implementation-design-v2.md) 21〜26章
