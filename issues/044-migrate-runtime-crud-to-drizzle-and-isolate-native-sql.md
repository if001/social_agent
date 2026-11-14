---
created_at: 2026-11-14
status: created
type: change
plan: []
requirements: [NFR-7, NFR-8]
requires: agent
---

# 044 runtime CRUDをDrizzleへ移行しPostgreSQL専用SQLを隔離する

元計画：#038のDrizzle移行方針。

## Dependencies

- #040
- #041
- #042
- #043

## Scope

- 通常select / insert / update / delete、upsert、transactionをDrizzleへ移す。
- repository外の`Pool.query` / `PoolClient.query`を除去する。
- vector RAG、lease claim、advisory lockなどはrepository内の明示的なPostgreSQL専用queryとして隔離する。
- test fixtureとDebug UI readerを新境界へ移す。

## Out of scope

- SQL最適化そのもの、RAG scoring変更、migration scriptの一律置換。

## Acceptance criteria

- [ ] NFR-7：通常CRUDがDrizzle schema型を利用する。
- [ ] NFR-8：atomic commit、idempotency、rollback、Outboxが維持される。
- [ ] 追加：PostgreSQL専用queryの一覧とrepository所有者が明確である。

## Tests

- NFR-7 / NFR-8：全integration suiteと主要live suiteでrepository移行後の動作を検証する。
