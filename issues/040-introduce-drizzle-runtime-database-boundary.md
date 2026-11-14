---
created_at: 2026-11-14
status: created
type: change
plan: []
requirements: [追加, NFR-7, NFR-8]
requires: agent
---

# 040 Drizzle runtime database境界とrepository portを導入する

元計画：#038のDrizzle境界設計。

## Dependencies

- #039

## Scope

- Drizzle database / transaction factoryを導入し、schema型をrepositoryへ提供する。
- applicationおよびTool adapterが`Pool` / `PoolClient`へ直接依存しないport境界を作る。
- transaction、通常CRUD、PostgreSQL専用`sql` queryの利用規則をコードで分離する。

## Out of scope

- Event / Reflection schemaの正規化。
- retrieval rankingやscheduler claimのアルゴリズム変更。

## Acceptance criteria

- [ ] 追加：通常CRUDがDrizzle transaction / query builderを通せる。
- [ ] NFR-7：repository境界を越えてPostgreSQL clientを渡さない。
- [ ] NFR-8：transaction rollbackと既存のatomic commitが維持される。

## Tests

- NFR-7 / NFR-8：実PostgreSQL integration testでcommit、rollback、idempotencyを検証する。
