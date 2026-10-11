---
created_at: 2026-10-11
status: done
---

# 120: Tool結果の用途別変換を一元化する（R03）

## Background

[チェックリストR03](../note/refactoring-checklist.md)。Harness、Recent Experiences、後処理、Observationで変換が分岐していた。依存: Issue 119。

## Scope

ToolRegistryのPolicyを共有し、Web固有の投影をTool側へ移す。Observationのcontentにも投影を適用し、監査のtool_executionsは元の結果を保持する。

## Out of scope

既存履歴の消去、本文保存形式変更、LLMプロンプト追加。

## Implementation notes

content-readは本文を文字数メタデータへ変換。即時Tool結果と監査は変換しない。通常結果の既存上限は共通経路へ集約し、各保存先の独自sliceを削除する。

## Acceptance criteria

- HarnessにWeb Tool名の分岐がない
- 履歴、Recent Experiences、後処理、Observationに同一Policyが適用される
- 監査と即時取得の本文は維持する

## Tests

用途別投影のunit、Harness contract、system、独立schemaでのPostgres integration、typecheck、lint。

## Result

型検査・lint成功。unit/contract 109件、追加後のtools unit 12件、system 25件、integration 24件成功。migration不要、実Ollama未使用。
