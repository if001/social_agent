---
created_at: 2026-11-14
status: created
type: change
plan: []
requirements: [FR-41, FR-42, FR-78, FR-79, FR-81, NFR-7]
requires: agent
---

# 042 Reflection監査snapshotとTool traceを正規化する

元計画：#038のReflection Session監査モデル。

## Dependencies

- #039
- #040
- #041

## Scope

- Reflection Session共通inputを`reflection_runs`の唯一のsnapshotとし、target / batch inputをselectorへ縮小する。
- Reflection Tool executionをrelationへ正規化し、attempt / batchのTool JSON配列を移行する。
- Reflection子tableから親で導出できる列を削除し、resolver監査を維持する。
- backfill、retry、Debug UI、実DB検証を更新する。

## Out of scope

- Reflectionの対象順序、LLM出力schema、RAG rankingの変更。

## Acceptance criteria

- [ ] FR-41 / FR-42：固定Session、部分成功、retry、監査が維持される。
- [ ] FR-78 / FR-79 / FR-81：Formation / Reconciliationの根拠、resolver、call予算を追跡できる。
- [ ] NFR-7：同じReflection入力が子recordに全複写されない。

## Tests

- FR-41 / FR-42：retry時のSession再開と失敗対象だけの再実行を検証する。
- FR-78 / FR-79 / FR-81：batch / anchor / Tool trace / resolutionの参照整合性を実PostgreSQLで検証する。
