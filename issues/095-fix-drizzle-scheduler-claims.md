---
created_at: 2026-11-26
status: done
type: fix
plan: []
requirements: [NFR-6, NFR-22]
ui: []
requires: human
---

# 095 SchedulerのclaimをDrizzle Repositoryへ戻す

起点：実DBで `app.concern_reevaluation_batches` が存在しない状態でSchedulerがraw SQL CTEを発行し、`relation does not exist` となった。ユーザーが定めたRepository層でのDrizzle ORM利用にも反する。

## Background

#094で追加したconcern reevaluation batchのclaimは、`PostgresScheduleRepository`にraw SQL CTEとして実装された。migration `0052_steep_chimera.sql` はDrizzle schemaから生成済みだが、実DBには未適用である。

## Dependencies

- #094 done

## Scope

- SchedulerのScheduled Task、autonomous schedule、concern reevaluation batchのclaim/release処理をDrizzle query builderとRepositoryの条件付き更新で実装する。
- 同時workerで同じ対象を二重claimしない条件付き更新を維持する。
- `concern_reevaluation_batches` のmigration/権限適用手順を明示し、実DBのtable不存在を解消できる状態にする。

## Out of scope

- migration SQLを手書きで作成・編集すること。
- 実DBへのmigration適用（管理者接続を用いるため人が実行する）。

## Implementation notes

- 人が行う作業：実DBで `pnpm db:migrate`、続けて `pnpm db:grant:concerns` を実行する。
- Agentが行う作業：Repository実装、並行claimテスト、検証、migration適用前後の手順確認。

## Acceptance criteria

- [x] AC-095-1：`PostgresScheduleRepository`はraw SQL CTEを使わず、Drizzle ORMのselect/updateでdue targetをclaimする。
- [x] AC-095-2：同時Repository workerが同じScheduled Task又はexperience batchを二重claimしない。
- [x] AC-095-3：`0052_steep_chimera.sql`を`pnpm db:migrate`で適用すれば、concern reevaluation batch tableが存在しSchedulerがclaimできる。
- [x] AC-095-4：typecheck、lint、unit/integration testが通る。

## Tests

- NFR-6：二つのScheduler Repositoryから同時claimした時、Taskおよび同一Focus Concernのbatchは一回だけ返るIntegration test。
- NFR-22：Drizzle条件付き更新でagent scope、due日時、lease期限を満たす対象だけをclaimするIntegration test。

## 実装メモ

- full-query CTEと`tx.execute(sql\`...\`)`を`PostgresScheduleRepository`から除去した。候補select後に、status・due時刻・lease期限を再確認するDrizzle条件付きupdateを行うため、競合したworkerは`returning`が空となり対象を返さない。
- 実DBへの`pnpm db:migrate`は2026-11-26に人が適用済み。`pnpm db:grant:concerns`でアプリ接続Roleへ新tableのDML権限を付与した後に、Scheduler実行確認とレビュー・mergeを行う。
- 検証済み：`pnpm typecheck`、`pnpm lint`、`pnpm test`、`pnpm db:migrate:test`、`pnpm db:grant:concerns:test`、`pnpm test:integration`。
- 実DBへの`pnpm db:grant:concerns`も2026-11-26に人が適用済み。新規batchがdueになった時、Drizzle Repositoryの条件付きclaimで処理される。
