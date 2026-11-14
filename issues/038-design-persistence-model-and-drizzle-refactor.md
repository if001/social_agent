---
created_at: 2026-11-14
status: done
type: change
plan: []
requirements: [追加]
requires: human
---

# 038 永続化モデルの正規化とDrizzle移行設計

元計画：2026-11-14の永続化層調査。主目的は、通常の生SQLをDrizzle ORMを使う書き方へ移行すること、DB schemaを正規化して不要・冗長なfieldを削除することである。`event_experiences` / `event_projections`を含む全runtime tableについて、正本・派生データ・監査記録の境界と移行設計を確定する。

## Background

現在の本番コードには`pool.query` / `client.query`による生SQL実行が約240箇所あり、Drizzleはmigration実行とschema宣言以外でほぼ利用されていない。application層とTool adapterにも直接PostgreSQLアクセスが漏れている。

実運用DBでは、`reflection_attempts`が約3,486件・約153MB、`reflection_runs`が約1,101件・約107MBである。入力・出力JSON snapshotの保持責務を分けずに複製すると、監査表が継続的に肥大化する。通常のEvent / Run / Experience参照は数千件規模であり、適切なindexを伴う正規化joinを避ける理由にはならない。

`events`は監査の正本であり、Event ExperienceはEvent固有の意味づけ、Event Projectionはその検索用派生インデックスとする既存の方向性を、schema・writer・reader・運用上の保持方針まで一貫させる必要がある。

## Dependencies

- #032 全LLM経路からRecord IDを除去（done）
- #034 隔離integration databaseと管理資格情報（done）
- #037 完了Experience IntegrationのEvent Experience形成（done）

## Scope

- 全`app` runtime tableについて、正本、派生index、実行監査、現在状態、関連テーブルのいずれかを明記したinventoryを作る。
- 各列について、正規の所有者、導出可能性、参照・検索・監査の利用箇所、保持期間、index要件を調査する。
- `events`、`agent_runs`、`tool_executions`、`experience_integrations`、`event_experiences`、`event_projections`、Reflection関連tableを優先して、重複snapshotと親から導出できる所有者列を特定する。
- Event Experienceを正、Event Projectionを検索専用の従属indexとする契約を、writer・repair・embedding backfill・readerに適用するための設計を定める。
- `agent_states`内のConcern / Relationship / Commitment JSONは、Agent State aggregateの楽観更新に必要な現在状態として扱うか、正規化対象とするかを、読書き経路と整合性要件から判断する。
- Evidence ID JSON、subject中間table、schedule、outbox、web archive、prediction関連について、JSON保持・中間table・親参照のいずれを採用するかを決める。
- 通常CRUD、transaction、repository境界をDrizzleへ移す方針と、pgvector / hybrid RAG、`FOR UPDATE SKIP LOCKED`、advisory lock、運用migration scriptとして生SQLを残す例外方針を定める。
- application / Tool層から直接`pg`アクセスを除くrepository / port境界を設計する。
- 既存実DBを安全に移行する順序、backfill、互換を持たない切替、rollback可否、隔離integration databaseと実DB検証を設計する。
- Drizzleが生成するDDL migrationと、既存recordを変換・検証する明示実行のdata migration scriptを分離する。過去Debug UI表示を目的とするsnapshot backfillは行わず、稼働中の参照・検索・未完了work itemを守る変換だけを行う。
- 設計確定後に、独立して実装できる後続Issueへ分割する。

## Out of scope

- このIssue内でのschema migration、table削除、production DB変更。
- pgvectorの検索アルゴリズム、Reflectionの認知設計、LLM promptの変更。
- 監査に必要な生のEvent、Run、Tool入出力を無根拠に削除すること。
- migration / 管理scriptでPostgreSQL固有SQLを一律に禁止すること。
- 旧`agent_runs`中心のDebug UI履歴を新schemaへ完全に再構成すること。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| ADDED | 追加 | 永続化データの正本・派生index・監査record・現在状態の所有権と参照規則 | `docs/ARCHITECTURE.md`、`docs/REQUIREMENTS.md` |
| ADDED | 追加 | Drizzleを通常DBアクセスの標準とし、PostgreSQL固有queryを限定例外とする実装規則 | `docs/ARCHITECTURE.md`、`docs/TEST_STRATEGY.md` |
| MODIFIED | NFR-7 / NFR-8 | 監査性・atomic commitを維持したschema移行、backfill、repository検証 | `docs/REQUIREMENTS.md`、`docs/TEST_STRATEGY.md` |

## 影響範囲

検索した語：`event_experiences`、`event_projections`、`agent_runs`、`tool_executions`、`experience_integrations`、`reflection_runs`、`pool.query`、`client.query`、`Drizzle`、`PostgreSQL`。

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/infrastructure/persistence/schema.ts` | 全runtime tableのschema宣言 | 後続実装Issueで更新 |
| `src/infrastructure/persistence/*.ts` | repository、transaction、RAG、scheduler、Reflectionの生SQL | 後続実装Issueで通常CRUDをDrizzleへ移行。PostgreSQL専用queryは明示的例外として維持またはDrizzle `sql`へ包む |
| `src/application/memory-*.ts` | application層からの直接`pg`アクセス | 後続実装Issueでport / repositoryへ移す |
| `src/infrastructure/tools/*.ts` | Tool adapterからのDBアクセス | 後続実装Issueでrepository境界へ移す |
| `src/debug-ui/repository.ts` | 監査・派生recordの読取り | schema責務確定後に更新 |
| `scripts/` | embedding backfill、運用DB操作 | migration / 管理用途を除きrepositoryを利用するか判断 |
| `tests/integration/`、`tests/live/` | 実migration、transaction、監査、RAGの検証 | 後続実装Issueで更新 |
| `docs/ARCHITECTURE.md` §永続化と運用保証 | PostgreSQLの正本、監査、commit境界 | 設計決定後に更新 |
| `docs/REQUIREMENTS.md` NFR-7 / NFR-8 | 監査・atomic commit | 設計決定後に更新 |
| `docs/TEST_STRATEGY.md` | 実PostgreSQL integration / migration検証 | 設計決定後に更新 |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-implementation-design-v2.md` | Runtime Persistenceの責務境界に、正本・派生index・監査recordの規則を追加するか判断 | 承認待ち |
| `docs/REQUIREMENTS.md` | 永続化・ORM・移行不変条件を要件化 | 承認待ち |
| `docs/ARCHITECTURE.md` | table責務、repository境界、PostgreSQL専用query例外を追加 | 承認待ち |
| `docs/TEST_STRATEGY.md` | schema migration、backfill、実DBでの整合性検証を追加 | 承認待ち |

## Implementation notes

- `events`は不変の論理Eventと観測入力の原記録、`agent_runs`はそのretryを含む実行attemptの判断入力・出力の監査とする。同一論理Eventに対するExperienceは成功commitごとではなく一度だけ形成する。`tool_executions`はRunを、`experience_integrations`はsource Runを親とする。
- `event_experiences`はEventに対する意味的経験の正本、`event_projections`は検索本文・embedding・検索フィルタに限定した従属indexとする。ProjectionはExperienceから一方向に更新される。
- 親から常に導出でき、子単独の検索・index・所有権検証に使われない列は削除候補とする。ただし、削除可否は全readerとDebug UIのqueryを確認して決める。
- JSONBを機械的に正規化しない。Agent State aggregate、bounded evidence、監査snapshotの用途、横断検索・参照整合性・更新競合の必要性を比較して決める。
- Drizzle ORMは型付きschema、insert/update/select、transaction、migrationに使う。`pgvector`、CTE ranking、advisory lock、lease claimなどはDB固有操作として、狭いrepository内の明示的な`sql`に閉じ込める。
- 実DBでは新旧writerの混在を避ける。schema追加、backfill、reader切替、writer切替、旧列削除を別migrationに分離する。
- schema変更はDrizzle schemaを正とし、`pnpm db:generate`でDDL migrationを生成する。既存データのDML変換は、dry-runを既定とし`--apply`でだけ書込むscriptとして追加する。各scriptは変換件数、未変換件数、参照整合性を出力し、snapshot未backfillを明示する。

## Acceptance criteria

- [x] 追加：全runtime tableと主要列について、正本・派生・監査・現在状態・関連の責務、owner、reader、writer、保持方針を示した設計表がある。
- [x] 追加：`event_experiences`と`event_projections`、Event / Run / Tool / Experience Integration間の正規化・参照方針が確定している。
- [x] 追加：Reflection関連table、Memory / Evidence、State JSON、Schedule、Outbox、Web archive、Predictionについて、残す重複と除く重複が根拠付きで決まっている。
- [x] 追加：Drizzleへ移す通常CRUDと、生SQLを許容するPostgreSQL固有queryの一覧・境界がある。
- [x] 追加：application / Tool層からDB直接アクセスを除くport / repository設計がある。
- [x] 追加：schema migration、backfill、reader / writer切替、rollback、実DB検証の実行計画がある。
- [x] 追加：後続実装Issueが、依存関係とデータ移行順序を持って分割されている。
- [x] 追加：一次ドキュメントへ反映する設計についてユーザー承認を得て、反映作業を#039へ依存関係付きで引き渡している。
- [ ] 追加：#039で一次文書を更新した後、`spec-analyze change`のCRITICAL / HIGHを解消する。

## Tests

- NFR-7：schema migration後もEvent / Run / Tool / Experience / Reflection監査の参照整合性を実PostgreSQL integration testで検証する。
- NFR-8：通常Eventのatomic commit、idempotency、rollback、Outboxがrepository置換後も維持されることを検証する。
- FR-35 / FR-37：Tool実績と監査投影が、正本と派生projectionの責務分離後も追跡できることを検証する。
- FR-78 / FR-79 / FR-81：Event Projection、Reflection root evidence、Memory reconciliationの検索・commit・retryが移行後も維持されることを検証する。

## 実装メモ

- 詳細設計案：`docs/work/note/2026-11-14-persistence-model-design.md`。
- 後続Issue：#039（正の文書反映）、#040（Drizzle境界）、#041（Event / Run / Experience / Projection）、#042（Reflection監査）、#043（導出可能所有者列）、#044（CRUD移行）、#045（実DB切替）。
- 過去Debug UIの完全互換は非目標とし、新writer切替後のEvent traceだけを表示する。既存データについては、active State、Memory、Schedule、Outbox、未完了Experience Integration / G3 / Reflectionと、検索・外部キー整合性に必要な派生dataだけをmigration対象とする。
- 独立レビュー：`docs/work/reviews/2026-11-14-issue-038.md`。
- ユーザー承認により、`events`を不変の論理Event、既存`agent_runs`をretryを含むEvent attempt / 入出力履歴として維持・正規化する方針で再開した。
- ユーザーは2026-11-14に、この設計に沿って後続Issueを順次完了することを承認した。一次文書への反映とその`spec-analyze`は#039の完了条件である。
