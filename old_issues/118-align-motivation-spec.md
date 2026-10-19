---
created_at: 2026-10-11
status: done
---

# 118: 動機モデルの一次情報を整合する（R01）

## Background

[チェックリストR01](../note/refactoring-checklist.md)に従う。Issue 111で採用済みのMotive統合がspecへ反映されず、別状態としてDrive / Current Interestが残っていた。

## Scope

- 概念設計・実装設計の動機契約を採用済み方針に整合する
- Motiveの形成、活性化、充足、収束、Selfとの差を明示する
- docsの根拠を明記し、残存するInterestProgressSchema名をMotiveProgressSchemaへ変更する

## Out of scope

- Coreと後処理の全フロー整理（R02）
- 新規心理モジュール、DB変更、Live実行

## Implementation notes

実装を正解として逆輸入せず、明示的に採用されたIssue 111の統合・必須Action方針を根拠とする。state-reviewとLong-term ReviewはInteractionの必須Action対象外。

## Acceptance criteria

- specにDrive / Current Interestを独立状態とする契約がない
- MotiveとactiveMotive、任意のgoal / progress、後処理での永続化を区別できる
- 旧Schema名のexportを残さない

## Tests

- 旧契約参照の静的検索とdiff確認
- typecheck、unit / contract

## Result

- specとdocsを更新。評価用のdrive/currentInterest変換と旧Schema名を削除。Interaction評価の更新対象をEmotionだけに修正。
- typecheck・lint成功、unit/contract 109件、evaluation 6件成功。外部接続なし、migration不要。
