---
created_at: 2026-10-11
status: done
---

# 145: 最小Agent loopの実装後に現行docsを一次資料へ整合する

## Background

[敵対レビューの重要な指摘12](../note/adversarial-review-2026-10-11.md#12-docsは現実を過大評価し古い説明も残っている)では、`docs/DESIGN_ALIGNMENT.md`に削除済みActionや旧Core責務が残り、歴史的auditも現行説明と混在していると指摘されている。一次資料は[概念設計](../spec/personal-agent-concept-design-restructured-v2.md)と[実装設計](../spec/personal-agent-implementation-design-v2.md)であり、docsは完成後の実装を過大評価せず説明する必要がある。

## Scope

- `docs/`を現行説明、運用手順、歴史的記録に分類する。
- 現行説明から削除済み`wait`、旧Core責務、旧Deep Agent middleware、同期Post-processなどを除く。
- 実装済み、未実装、評価で未証明を明確に区別する。
- 歴史的auditには時点と非現行である旨を付け、現行設計の入口から分離する。
- Issue 134〜144で確定したAction、Context、loop、state、schedule、評価フローを反映する。

以下の３つが./spec/から作成した２次ドキュメントです。
docs/ARCHITECTURE.md
docs/REQUIREMENTS.md
docs/TEST_STRATEGY.md

それ以外のドキュメントは./docs/D3/ 以下に配置してください。

## Out of scope

- 一次資料の要求をdocs都合で変更すること。
- 歴史文書の削除。
- 未実装機能を実装済みとして記述すること。

## Implementation notes

- 実装とtest/evaluation artifactを照合して記載する。
- 概念設計との適合を主張する場合は、対応する反復評価結果へリンクする。
- `docs/IMPLEMENTATION_AUDIT.md`等は履歴として保持し、現行statusと混同させない。
- 修正時はレビュー本文と一次資料を読み直し、二次資料を根拠に一次資料を上書きしない。

## Acceptance criteria

- 現行docsのAction集合、Core出力、Post-process、schedule、limitが実装と一致する。
- 歴史文書と現行文書を入口から判別できる。
- 「実装済み」と「振る舞いを評価済み」が区別される。
- docs内linkと主要diagramが有効である。

## Tests

- docs link checkerと用語検索。
- Action/contract名を実装から照合するdocumentation test。
- diagram render確認。
- reviewerによる一次資料とのspot check。

## Dependencies

- 134〜144

## Source plan

- [敵対レビュー: 指摘12](../note/adversarial-review-2026-10-11.md#12-docsは現実を過大評価し古い説明も残っている)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
