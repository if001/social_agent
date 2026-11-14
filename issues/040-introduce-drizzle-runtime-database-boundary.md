---
created_at: 2026-11-14
status: done
type: change
plan: []
requirements: [NFR-8, NFR-11]
requires: agent
---

# 040 Drizzle runtime database境界とrepository portを導入する

元計画：#038のDrizzle境界設計。

## Dependencies

- #039

## Scope

- Drizzle database / transaction factoryを導入し、schema型をrepositoryへ提供する。
- applicationおよびTool adapterが`Pool` / `PoolClient`へ直接依存しない用途別repository port境界を作る。
- transaction、通常CRUD、PostgreSQL専用`sql` queryの利用規則をコードで分離する。

## 詳細設計

- `RuntimeDatabase`はDrizzle databaseとtransaction APIを提供するinfrastructure内部の接続境界とする。repositoryだけがこれを受け取り、application / Tool / UIへ公開しない。
- `RuntimeTransaction`はDrizzle query builderによる通常CRUDと、同一transaction内でのみ使える`execute(sql\`...\`)`を提供する。`Pool` / `PoolClient`型をdomain、application、Toolの公開interfaceへ露出しない。
- portは汎用query実行関数ではなく、用途別interfaceとする。#040では既にapplication / Toolから直接参照されるMemory更新、Agent Context、Scheduled Taskのportを導入し、呼出側はportだけに依存させる。実装は既存PostgreSQL repository adapterで開始し、#044でその内部CRUDをDrizzle query builderへ移す。
- #040でport化するMemory更新、Agent Context、Scheduled TaskのPostgreSQL adapterは`RuntimeDatabase`を受ける。その他の既存infrastructure repositoryは#044で内部CRUDをDrizzle化する際に同じ境界へ移し、新規の`Pool`公開APIを増やさない。
- advisory lock、vector / hybrid RAG、lease claim、rate-window原子更新はrepository内のnative SQLとして維持する。通常CRUDのSQL置換は#044の責務とし、#040ではアルゴリズムを変えない。
- migration runnerと管理scriptはruntime port外であり、管理資格情報と明示実行を維持する。

## Out of scope

- Event / Reflection schemaの正規化。
- retrieval rankingやscheduler claimのアルゴリズム変更。

## Acceptance criteria

- [x] NFR-11：通常CRUDがDrizzle transaction / query builderを通せる。
- [x] NFR-11：repository境界を越えてPostgreSQL clientを渡さない。
- [x] NFR-8：transaction rollbackと既存のatomic commitが維持される。

## Tests

- NFR-8 / NFR-11：実PostgreSQL integration testでcommit、rollback、idempotencyを検証する。

## 実装メモ

- `RuntimeDatabase`をproduction compositionで一度だけ生成し、Memory更新、Agent Context、Scheduled TaskのPostgreSQL adapterへ注入した。通常CRUDをDrizzle transactionで実行でき、既存native SQLは#044までrepository内部へ限定して維持する。
- Agent ContextとScheduled Taskは用途別portへ分離し、application / Tool公開interfaceから`Pool`、`PoolClient`、汎用SQL queryを除いた。Memory書込みSQLもapplicationからinfrastructure repositoryへ移した。
- `NFR-8, NFR-11: exposes typed Drizzle CRUD and rolls back a repository transaction`で実DBのcommit / rollbackを、既存Memory更新Integrationでatomicity / idempotencyを確認した。`NFR-11: keeps PostgreSQL clients behind purpose-specific repository adapters`でproduction wiringと境界契約を固定した。
- `pnpm typecheck`、対象lint、Unit 237件、System 54件、Integration 55件、buildが成功した。全体lintは#040外の既存46件、Evaluationは#040外の既存FR-23 mood期待差で失敗するため既知ベースラインとして記録した。
- ID検査はERROR 0件。既存WARN 7件は#040固有ではない。
- 独立レビュー: `docs/work/reviews/2026-11-14-issue-040.md`。
- 上流への反映: NFR-11とADR-8に既に反映済み。追加変更は不要。
