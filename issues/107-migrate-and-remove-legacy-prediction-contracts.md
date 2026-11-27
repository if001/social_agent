---
created_at: 2026-11-27
status: done
type: change
plan: []
requirements: [FR-48, FR-49, FR-51, FR-62, NFR-8, NFR-11]
requires: agent
---

# 107 旧Prediction・G3 JSONを移行して互換readerを削除する

元計画：[G1/G2・G3 契約レビュー](../docs/work/analyze/2026-11-27-g1-g3-contract-review.md)

## Background

現行readerは旧`remember` / `observationCandidates`を正規化する互換コードを持つ。
G3も旧出力を再実行対象に残し得る。現行契約へのdata migration完了後は、旧形式を読まない。

## Dependencies

- #105 完了
- #106 完了

## Scope

- Prediction JSONと未完了G3 taskの旧形式を検出するdry-run既定migration scriptを作る。
- `--apply`で現行契約へ移行し、未解決・不正Recordがあればreader切替を中止する。
- migrationの成功確認後、legacy prediction normalizer、旧G3 task fallback、旧schema testを削除する。
- 一次仕様・Requirementsから旧互換の記述を除去する。

## Out of scope

- Prediction契約自体の再変更。
- 他領域のlegacy JSON migration。

## 差分

| 種別 | ID | 内容 | 文書 |
| --- | --- | --- | --- |
| MODIFIED | C-50〜C-52 | 現行Prediction / G3 JSONだけを読取る | spec/prediction-error-design.md |
| MODIFIED | FR-48, FR-49, FR-51, FR-62, NFR-8, NFR-11 | data migrationとcompat reader除去を定義する | docs/REQUIREMENTS.md |

## Acceptance criteria

- [x] dry-runで旧Prediction / G3 taskを件数・不正理由付きで報告する。
- [x] `--apply`は現行形式へ正規化し、不正又は未完了Recordがあればreader切替を中止する。
- [x] `normalizeLegacyPredictionOutput`、旧task fallback、旧形式testが削除される。
- [x] migration後、現行形式以外をreaderが受理しない。

## Tests

- NFR-8：dry-runは書込みを行わず、`--apply`だけがtransactionalに変更する。
- NFR-11：旧readerを削除後、現行Prediction / G3 taskだけを読取る。
