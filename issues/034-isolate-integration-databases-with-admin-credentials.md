---
created_at: 2026-11-13
status: done
type: fix
plan: []
requirements: [AC-3]
requires: agent
---

# 034 Integration testの管理DB資格情報と隔離database化

## Background

`app` schema固定後も複数のintegration testが`POSTGRES_URL`でschema作成とmigrationを行っている。実行用の`POSTGRES_URL`はDDL権限を持たないため、`ADMIN_POSTGRES_URL`で隔離databaseとmigrationを作成し、`POSTGRES_URL`でruntime検証を行う共通fixtureへ移行する必要がある。

## Dependencies

- #033

## Scope

- integration test全体の隔離database fixtureを追加する。
- DDL/migrationを管理接続、repository/runtime検証を実行接続へ分離する。
- 旧Prediction行の実DB互換読取りをintegration testへ追加する。

## Acceptance criteria

- [x] AC-3：`pnpm test:integration`が実行用DB資格情報へDDL権限を要求しない。
- [x] FR-48：実DBに保存した旧Predictionをrepository/contextが現行契約として読める。

## Tests

- AC-3：管理接続で作成した隔離databaseに対して実行接続でrepository testを通す。
- FR-48：旧fieldの正規化前後とContext読取りを実PostgreSQLで検証する。

## Result

- `.env.db.test`の`TEST_ADMIN_POSTGRES_URL`だけでschema/migration/cleanupを実行し、`TEST_POSTGRES_URL`はrepository/runtime検証に限定した。
- runtime/adminが同じ`*_test` databaseを指すことを接続後に検証してから破壊的なcleanupを行う。
- `pnpm test:integration`（実PostgreSQL）: 51 tests passed。
