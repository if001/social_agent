---
created_at: 2026-11-14
status: created
type: change
plan: []
requirements: [追加, NFR-7, NFR-8]
requires: human
---

# 039 永続化モデルの要件・Architecture反映

元計画：#038の承認済み設計案。

## Dependencies

- #038

## Scope

- 正本、派生index、監査record、現在Stateの責務と参照規則を一次仕様・Requirements・Architectureへ反映する。
- 通常CRUDのDrizzle標準化と、PostgreSQL固有queryの限定例外を定める。
- schema migration、backfill、reader/writer切替、実DB検証の不変条件をTest Strategyへ追加する。

## Out of scope

- schema / コードの変更。

## Acceptance criteria

- [ ] 追加：一次仕様への変更についてユーザー承認を得る。
- [ ] NFR-7 / NFR-8：監査・atomic commitを失わない永続化境界が正の文書で定義される。
- [ ] 追加：後続Issueが参照できる正本・派生・監査の用語と移行規則が定義される。

## Tests

- 追加：`spec-analyze change`でCRITICAL / HIGHがない。
