---
created_at: 2026-11-24
status: created
type: feature
plan: []
requirements: [FR-8, FR-24, FR-69, FR-76]
ui: []
requires: agent
---

# 079 新しい経験からConcernを派生させる限定lifecycle loopを実装する

元設計：[#077](077-redesign-concern-due-as-motivational-reevaluation.md)

## Dependencies

- #078 done

## Scope

- trigger Memory / external changeから、subject・時刻・embedding・keywordでactive ConcernをHybrid Retrievalする。
- ID-free viewと限定read-only Toolを使う`concern-due` lifecycle loopを実装する。
- 出力を「derive proposal 0..N」と任意の通常Actionへ限定し、親Concernのupdate / status変更 / replaceをRuntimeで拒否する。
- 現在の具体的Desireがある時だけ発話し、それ以外は`no-external-action`で完了する。

## Out of scope

- Concern系譜の永続schema（#080）
- Reflectionの整理（#081）

## Acceptance criteria

- [ ] AC-079-1：関連Concern候補だけがID-freeでモデルへ渡る。
- [ ] AC-079-2：根拠経験から別の持続的関心が生じた時だけderive proposalをcommitできる。
- [ ] AC-079-3：親Concernのreplace・更新・終了、過去予定の実行、発話のみを目的とするRunを拒否する。
- [ ] AC-079-4：発話が必要なDesireだけ配送され、no-opは監査付きで成功する。

## Tests

- FR-69：同一Concernの詳細化だけではderiveされず、別の持続的関心だけがforkされる。
- FR-69：親Concernのstatus / 本文がconcern-dueで変更されない。
- FR-76：具体的DesireなしではOutboxを作らず、no-external-actionで完了する。
