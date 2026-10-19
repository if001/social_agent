---
created_at: 2026-10-11
status: done
---

# 119: Core・Tool Loop・後処理の正規フローを確定する（R02）

## Background

[チェックリストR02](../note/refactoring-checklist.md)。採用済みの内部Tool loopと用途別後処理が一次情報の旧フローと不整合だった。依存: Issue 118。

## Scope

実装設計 §3・§19〜§21・§26とArchitectureの契約を整合する。

## Out of scope

配送経路のコード修正（R06）、Tool結果変換の共通化（R03）。

## Implementation notes

過去に採用された方針を根拠とする。Tool Resultは記録用Eventであり、再投入による二重loopを作らない。応答後処理は配送成功を待つ意味ではない。

## Acceptance criteria

- Interaction / Continuity / Memory / Candidate / Reviewの責務を区別できる
- Toolは最終Actionではなく内部loopで実行される
- 持続状態と即時状態の更新範囲が明確

## Tests

文書差分・リンク・コードの担当箇所を静的確認。コード変更なし。配送経路の不一致はR06、wait残存は契約整理時の対象として記載。
