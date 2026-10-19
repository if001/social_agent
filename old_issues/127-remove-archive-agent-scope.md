---
created_at: 2026-10-11
status: done
---

# 127: 共有Archiveの未使用agentId引数を削除する（R10）

## Background

[チェックリストR10](../note/refactoring-checklist.md)。searchとbackfillはagentIdを受けるが利用していなかった。

## Scope

引数と呼び出し元を変更する。保存者provenanceは維持する。

## Out of scope

個体Memoryの共有、データ移行。

## Implementation notes

実装設計 §16・§28と採用済みの共有Web Archive方針に従う。外部資料の共有は、個体の経験Memoryの共有とは異なる。

## Acceptance criteria

検索APIに個体分離を誤認させる引数がなく、保存者情報が残る。

## Tests

型検査、Tool unit、Archive integration、対象lint。

## Result

型検査・対象lint成功。Tool unit 12件、共有Archive integration 1件成功。
