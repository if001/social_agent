---
created_at: 2026-11-14
status: created
type: change
plan: []
requirements: [NFR-7, NFR-8]
requires: agent
---

# 043 監査・作業itemの導出可能所有者列と外部キーを整理する

元計画：#038のtable inventory。

## Dependencies

- #039
- #040

## Scope

- Prediction、G3、schedule、outbox、web archive、runtime state、Memory auditを対象に、Eventから導出可能な所有者列、欠けたFK、必要なindexを整理する。
- 子単独のclaim / ownership filter / retentionに必要なdenormalizationだけを残す。
- TTL対象のruntime stateと監査保持のcleanup方針を実装可能な形へ落とす。

## Out of scope

- Event / Reflection core tableの変更。
- 実データの監査record削除。

## Acceptance criteria

- [ ] NFR-7：parent参照をたどれば得られる値を二重の正本として保持しない。
- [ ] NFR-8：queue claim、delivery、lock、rate limit、Web provenanceの整合性を維持する。

## Tests

- NFR-7 / NFR-8：FK、削除規則、claim、delivery、runtime cleanupのintegration testを追加する。
