---
created_at: 2026-10-11
status: done
---

# 116: Deep Agentの最終構造化出力を保証する

## Background

直近10 Runがすべて失敗している。通常Toolは実行できているが、探索後に構造化出力Toolを複数返すか、graph stepまたはdeadlineを使い切り、最終Actionを保存できていない。

## Scope

- graphの残りstepが少ない場合は通常ToolをModel Callから外し、最終出力へ移行する。
- 同一Model Callで有効な構造化出力が複数返された場合は1件へ正規化する。
- 通常Tool Callと構造化出力Callが混在する応答は勝手に正規化しない。
- 回帰テストを追加する。

## Acceptance criteria

- [x] 最終化に必要なgraph stepを探索で使い切らない。
- [x] 複数の有効な構造化出力Callを1件として処理できる。
- [x] 通常Toolの実行履歴を変更しない。
