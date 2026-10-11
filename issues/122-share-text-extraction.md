---
created_at: 2026-10-11
status: done
---

# 122: FileとWeb Archiveのテキスト抽出を共通化する（R05）

## Background

[チェックリストR05](../note/refactoring-checklist.md)。文字数・周辺行・検索正規化の処理が別々だった。依存: Issue 120。

## Scope

純粋関数として行分割、範囲抽出、検索範囲、件数と文字数の制限を共有する。

## Out of scope

ファイル権限、Snapshot解決、公開Toolの統合。

## Implementation notes

実装設計 §26・§29・§30に沿う。Archive検索もNFKCを使用し、件数上限ちょうどで省略がない場合はtruncatedをfalseにする。ファイルのsnippetとArchiveの行ごとの出力形式は維持する。

## Acceptance criteria

共有抽出関数を両Toolが利用する。履歴はR03のPolicyを通り、権限境界を混ぜない。

## Tests

空入力、CRLF、長大行、末尾、Unicode、周辺行、上限のunit。既存Tool unit、DB archive integration、typecheck、対象lint。

## Result

型検査・対象lint成功。抽出unit 4件、Tool unit 12件、DB integration 24件成功。
