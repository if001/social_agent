---
created_at: 2026-10-11
status: done
---

# 121: Web Toolの入力Schemaを単一定義にする（R04）

## Background

[チェックリストR04](../note/refactoring-checklist.md)。登録Schemaとexecute内の再parseで同じSchemaが二重定義されていた。

## Scope

Archive search/read/grepのSchemaを定数にし、検証済み入力の型を推論する。

## Out of scope

公開パラメーター変更、検索挙動変更。

## Implementation notes

実装設計 §26・§29に従い、ToolRegistry.executeを入力検証の境界とする。

## Acceptance criteria

execute内に重複Schemaとparseがない。defaultと入力制約を維持する。

## Tests

typecheck、既存Tool unitによる不正入力・read境界・副作用前の検証。

## Result

型検査・対象lint・Tool unit 12件成功。公開契約とDBは変更なし。
