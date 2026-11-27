---
created_at: 2026-11-27
status: created
type: change
plan: []
requirements: [FR-48, FR-49, FR-62, NFR-7, NFR-8, NFR-11]
requires: agent
---

# 106 Prediction Evaluationの正本をimmutable JSONへ統合する

元計画：[G1/G2・G3 契約レビュー](../docs/work/analyze/2026-11-27-g1-g3-contract-review.md)

## Background

`prediction_records.output` と `prediction_evaluations` relationが同じ評価を二重に保持している。
予測一件の監査正本をimmutable JSONへ統合し、Debug UIもそこから読む。

## Dependencies

- #105 完了

## Scope

- `prediction_evaluations` relationへのwriter / readerを削除する。
- Debug UIの評価表示を`prediction_records.output`から復元する。
- Drizzle schemaからrelationを削除し、`db:generate`によるmigrationを作成する。
- migration前にJSON正本へ評価を補完する必要がある場合だけ、dry-run既定のmigration scriptを作る。

## Out of scope

- G1/G2の評価意味・G3起動契約の変更（#105）。
- legacy Prediction JSONを現行JSONへ移行する処理（#107）。

## 差分

| 種別 | ID | 内容 | 文書 |
| --- | --- | --- | --- |
| MODIFIED | C-50, C-54, C-62 | Predictionの監査正本とDebug読取りをJSONへ統合する | spec/prediction-error-design.md |
| MODIFIED | NFR-7, NFR-8, NFR-11 | 監査・migration・schema正本を更新する | docs/REQUIREMENTS.md |

## Acceptance criteria

- [ ] evaluationは`prediction_records.output`だけに一度保存される。
- [ ] Debug UIはrelationなしに評価を表示する。
- [ ] Drizzle生成migrationでrelationを削除できる。
- [ ] data migrationはdry-run既定で、完了確認後にのみdropを許可する。

## Tests

- NFR-7：Prediction保存とDebug読取りが同一immutable JSONを使う。
- NFR-8 / NFR-11：migration前後に二重writer / readerが残らない。
