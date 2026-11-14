---
created_at: 2026-11-14
status: done
type: change
plan: []
requirements: [NFR-7, NFR-8, NFR-11]
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

- [x] NFR-7：通常CRUDがDrizzle schema型を利用する。
- [x] NFR-8：atomic commit、idempotency、rollback、Outboxが維持される。
- [x] NFR-11：application・Tool・UI entry pointは直接SQLを所有せず、通常CRUDはrepositoryのDrizzle境界を通る。
- [x] 追加：PostgreSQL専用queryの一覧とrepository所有者が明確である。

## PostgreSQL専用query inventory

| owner | 用途 | Drizzle CRUDへ置換しない理由 |
|---|---|---|
| `PostgresScheduleRepository` | `FOR UPDATE SKIP LOCKED`による期限到来Taskのclaim | 複数worker間のlease取得を1つの原子的statementにするため |
| `PostgresG3TaskRepository` | 条件付きlease claim / `SKIP LOCKED` | attempt・deadline・leaseを同時に検証してclaimするため |
| `PostgresRuntimePersistence` | rate windowの原子的upsert | 同時実行時も上限判定とincrementを分離しないため |
| `PostgresAgentLeaseRepository` / `postgres.ts` | advisory lock、DB health check | PostgreSQL session / transaction lockそのものが要件のため |
| `PostgresRetrievalService` / `PostgresWebArchive` / `PostgresReflectionRepository` | pgvector、全文順位、RAG候補抽出 | vector演算・window関数・固定Event窓のrankingをDB内で完結させるため |
| `PostgresReflectionRepository` | Reconciliation候補選択、formation evidenceのhybrid ranking | fixed Event window内の候補順位付けをDB内で完結させるため |
| `DebugUiRepository` | JSON path、latest Runのlateral join、複数ledgerのread projection | 読み取り専用の監査projection。UI entry pointからDB clientを除去し、SQL所有権をrepositoryへ限定した |

通常のselect / insert / update / delete、transactionは各repositoryのDrizzle schema型を使う。上表以外のapplication、Tool、UI entry pointは`pg` clientを受け取らない。

## Tests

- NFR-7 / NFR-8：全integration suiteと主要live suiteでrepository移行後の動作を検証する。

## Verification

- `pnpm exec tsc --noEmit --pretty false`
- `pnpm exec eslint`（変更対象）
- `pnpm test`（239 tests）
- `pnpm run test:integration`（63 tests、隔離PostgreSQL）
- `pnpm run test:system`（56 tests）
- `pnpm run test:evaluation`（15 tests）
- `pnpm run db:generate`（schema changeなし）
- 変更分析: `docs/work/analyze/2026-11-15-change-issue-044.md`

## Implementation notes

- Tool、Prediction、Runtime、Embedding、G3、Scheduler、Context、Web archive、Memory write、Event transaction、Experience Integration、Reflectionの通常CRUDとtransactionを`RuntimeDatabase`へ統一した。
- Bot HostのAgent process lockと起動時schedule初期化を`PostgresAgentLeaseRepository`へ分離した。
- Debug UI entry pointは`DebugUiRepository.fromDatabase`だけを利用し、任意SQLを実行できる`Pool`を持たない。
- `g3_tasks.plan`は過去snapshotにのみ存在して実DBにはないため、runtime repositoryは実DBと一致するtyped query tableを所有する。schema cutoverで扱う履歴driftを本IssueのCRUD移行に混入させない。
- `db:generate`でschema差分がないことを確認した。既存DB migrationは不要。
