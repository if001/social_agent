---
created_at: 2026-10-11
status: done
---

# 131: Deep Agent Harnessの責務を分割する（R14）

## Background

[チェックリストR14](../note/refactoring-checklist.md)。接続、Tool実行、Middleware、プロンプト、履歴変換、応答ログが一つのファイルに集まっていた。依存: R03・R08。

## Scope

プロンプト、Tool実行、Middleware、履歴変換、Model応答要約を独立moduleへ移す。呼び出し元は正規moduleへ変更し互換exportを残さない。

## Out of scope

LLM実行回数、Schema、Tool処理、履歴短縮の挙動変更。

## Implementation notes

実装設計 §2・§26・§29に沿う。HarnessはDomain出力検証とGraph組み立て、各moduleは単一の責務を担当する。R05でFileのread/grepも処理単位へ整理済み。

## Acceptance criteria

module間に循環依存がなく、公開indexとテストが新しい配置を参照する。既存のGraph/Tool動作を維持する。

## Tests

型検査、全unit/contract、system、evaluation、lint。外部LLMは使用しない。

## Result

型検査、unit/contract 120件、system 29件、evaluation 6件成功。全体lintの型import指摘を修正し、対象lint再実行で成功。Harness本体169行。
