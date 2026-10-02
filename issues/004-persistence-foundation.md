---
created_at: 2026-10-02
status: created
---

# 004: PostgreSQL、migration、Repository基盤を実装する

## Goal

個体状態とtraceを、分離・整合性・再起動復旧を保って永続化する。

## Scope

- pgvector extensionとDrizzle migration
- Architecture 10.2のtable、Drizzle Schema、drizzle-zod境界
- Repository、Unit of Work、optimistic lock、Agent advisory lock
- message receipt、outbox、test DB provisioning

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-04
- `docs/ARCHITECTURE.md` 10、11章
- `docs/TEST_STRATEGY.md` 8.3、9.1、9.2、9.5

## Acceptance criteria

- [ ] 空DBへ全migrationを適用・再適用できる
- [ ] Agent IDによる完全な分離と外部キー整合性がある
- [ ] 1 Event分の更新とoutboxを1 transactionで保存できる
- [ ] version競合を拒否し、process終了時にAgent lockを解放する
- [ ] 永続状態を再起動後に復元できる

## Tests

- Repository contractをtest doubleとPostgreSQL実装へ適用
- migration、round trip、rollback、version、outbox、advisory lockのintegration test

## Dependencies

- 002
- 003
