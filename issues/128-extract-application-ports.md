---
created_at: 2026-10-11
status: done
---

# 128: Application側へ必要なportを移す（R11）

## Background

[チェックリストR11](../note/refactoring-checklist.md)。PostProcessServiceがInfrastructureのinterfaceを参照し、Web ToolもPostgres具象クラスから契約を抽出していた。

## Scope

用途別Harness interfaceとWebArchive / Summarizer portをApplicationへ移し、Adapterが実装する。旧moduleの互換re-exportは残さない。

## Out of scope

汎用Repository導入、実行フローの変更。

## Implementation notes

実装設計 §2・§29の責務分離に従う。公開indexからの型exportは正規portを参照する。

## Acceptance criteria

PostProcessServiceがInfrastructureをimportせず、Web Tool契約がPostgres名に依存しない。

## Tests

型検査、Tool/Post-process unitによる模擬実装の差し替え、対象lint。

## Result

型検査・対象lint成功。Tool/Post-process unit 15件成功。
