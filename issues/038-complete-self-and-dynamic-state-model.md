---
created_at: 2026-10-04
status: created
---

# 038: SelfとDynamic Stateの欠落要素を実装する

## Background

specのStableStateはInterests、Preferences、Raison d'être、複数Roleを持ち、DynamicStateは複数Drive、Desire、currentInterestsを持つ。現在の型とDBはこれらを欠くか、Drive／Desire／Roleを単一文字列へ縮退しており、長期・中期状態の意味を十分に表現できない。

## Scope

- `spec/`を一次情報としてSelf／StableState／DynamicStateをdocsと照合し、docsを先に修正する。
- Interests、Preferences、Raison d'être、Roleの表現と更新時間スケールを確定する。
- Drive、Desire、currentInterestsを複数項目として扱えるDomain Schema、DB migration、Repository、Context、proposal契約を実装する。
- 既存の単一文字列dataを失わないmigrationを用意する。
- 通常CoreとLong-term Reviewの更新責務を状態ごとに明確化する。

## Out of scope

- Long-term Review triggerとCandidate統合の実装。
- UIでの状態編集画面。
- 数値priorityや固定行動規則の導入。

## Implementation notes

- 自然言語を基本としつつ、複数項目のidentityとlifecycleを追跡できる構造にする。
- InterestsとDispositionを混同せず、短期`currentInterests`と長期Interestを分ける。
- 既存Agentのmigration defaultが人格を勝手に追加しないようにする。

## Acceptance criteria

- [ ] specにあるSelf／State要素がdocs、Domain、DB、Contextで対応する。
- [ ] 複数Drive／Desireを保持・更新できる。
- [ ] Interests／Preferences／Raison d'être／Roleを適切なReview経路で更新できる。
- [ ] 既存dataを保持したmigrationが再実行可能である。

## Tests

- Schemaとstate updateのunit test。
- migration／round-trip／旧data移行のintegration test。
- Context owner分離とprompt inputのcontract test。

## Dependencies

- なし

## Plan reference

- [Implementation Design §5–7, §11–13, §21](../spec/personal-agent-implementation-design-v2.md)
- [Architecture: State Model](../docs/ARCHITECTURE.md)
