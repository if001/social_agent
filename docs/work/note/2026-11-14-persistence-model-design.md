# 永続化モデルとDrizzle移行の設計案

対象：Issue #038。これは正の仕様ではなく、一次仕様への反映前に承認を得るための設計案である。

この変更の目的は二つだけである。

1. 通常の生SQLをDrizzle ORMを使う書き方へ移す。
2. schemaを正規化し、不要・冗長なfieldを削除する。

旧Debug UI履歴の再構成は非目標とする。新writer切替後のEvent traceが表示できればよい。

## 1. 判断原則

1. **原記録は一度だけ保存する。** `events`は不変の論理Event・観測入力、`agent_runs`はその各処理attemptの判断入力・出力である。Tool実行とprovider出力も監査recordに置き、派生表へ全入力・全出力を複写しない。
2. **論理Eventとattemptを混同しない。** 同じEventのretryは別`agent_runs` rowとし、Event Experienceは成功した論理Eventごとに一度だけ形成する。これによりretryがMemory / Reflectionの重複経験にならない。
3. **意味表現と検索indexを分離する。** Event ExperienceはEventの意味的な経験表現の正、Event Projectionはそれを検索するための従属indexである。
4. **親から導出できる所有者列は保存しない。** ただし、子表だけを所有権で絞るindex、キューclaim、削除境界、独立した作成主体に必要な列は残す。
5. **JSONを機械的に分解しない。** Agent State aggregate、短い上限付き根拠、provider artifactはJSONでよい。個別に検索、外部キー、更新、履歴を必要とする集合だけをrelationにする。
6. **通常CRUDはDrizzle、PostgreSQL固有操作はrepository内の`sql`に閉じる。** adapter/application/toolが`Pool`や`PoolClient`を直接受け取らない。
7. **migrationはexpand → data migration → reader切替 → writer切替 → contract → dropの順に進める。** 旧Debug UIの過去履歴をbackfillしない。新旧writerは同一DBで並走させない。

## 2. データ責務 inventory

| table | 分類 | 正の責務 | 方針 |
|---|---|---|---|
| `agent_families` | canonical | family定義 | 維持 |
| `agents` | canonical | Agentの恒久的identity | 維持 |
| `agent_states` | canonical aggregate | 現在のSelf / Mood / Concern / Relationship | JSON aggregateとして維持。個別Concern tableにはしない |
| `events` | canonical | 不変の論理Eventと生の観測入力 | 維持。retryごとに増えない。全Experienceの起点 |
| `agent_runs` | audit | Event処理attemptの判断入力断面、構造出力、失敗 | 維持。`agent_id`はEventから導出するため削除候補。retryは別row |
| `tool_executions` | audit | Run内Tool callの完全入出力 | `event_id`と`result_event_id`はRun / Tool auditから導出または不要のため削除候補。idempotencyは`run_id + tool_call_id`で維持 |
| `state_changes` | audit | Runによる状態差分 | `run_id`を正の親として維持。`evidence_ids`は小さな異種根拠集合なのでJSON維持 |
| `experience_integrations` | audit / commit | RunからのCommit Layer provider出力、適用結果、再試行状態 | `source_run_id`を正の親とし、`agent_id` / `source_event_id`とinput内のEvent・Run・Tool複写を除く |
| `event_experiences` | derived canonical | 一つのEventの短い意味的経験 | `event_id`をPKとし、summary / facts / source integrationを保持。`agent_id` / `occurred_at` / actor由来subjectはEventまたはsubject relationから導出する |
| `event_subjects`（追加） | relation | Event Experienceの検索subject | JSON arrayを置換。subject検索・整合性に使う |
| `event_projections` | derived index | Event Experienceのembeddingと検索状態 | `event_id`、embeddingとそのmodel/dimension/status/error/attempt時刻だけを保持。本文・kind・時刻・subject・agentはjoinで得る |
| `memories` | canonical derived knowledge | 長期Memoryの現行内容 | 維持。embedding metadataはMemory本文に従属するため維持 |
| `memory_subjects` | relation | Memoryとsubject | 維持 |
| `memory_mutations` | audit | Memory変更意図と結果 | 維持。`agent_id`はMemory未作成mutationもあるため維持 |
| `memory_web_evidence` | relation | MemoryとWeb snapshot | 維持 |
| `background_experiences` | canonical seed | Agent固有の事前経験 | 維持。participants/tagsは検索対象でないためJSON維持 |
| `web_resources` | canonical | canonical URL | 維持 |
| `web_snapshots` | canonical archive | fetchしたWeb本文・要約・embedding | 維持。source run / tool call / eventはprovenanceとして保持 |
| `prediction_records` | audit | prediction provider出力 | `source_run_id`を正の親にし、`agent_id` / `source_event_id`はRunから導出するため削除候補 |
| `prediction_evaluations` | audit | Prediction error評価 | `agent_id`はpredictionから導出するため削除候補 |
| `g3_tasks` | canonical work item | 非同期G3 task | `agent_id`はtask claimの所有者境界として維持。source prediction/eventにはFKを追加するか調査 |
| `scheduled_tasks` | canonical work item | 明示taskの期限・状態 | `source_run_id`をprovenanceとし、`source_event_id`はRunから導出するため削除候補 |
| `autonomous_schedules` | canonical work item | 自律Eventの次回起動 | 維持。`concern-due`との対応はstate aggregate内Concern IDのため外部キー化しない |
| `message_receipts` | canonical delivery | inbound冪等性 | 維持 |
| `outbox_messages` | canonical delivery | outbound配送状態 | 維持 |
| `runtime_correlations` | runtime state | loop防止 | 維持。TTL / cleanup方針を追加 |
| `runtime_rate_windows` | runtime state | rate limit window | 維持。TTL / cleanup方針を追加 |
| `agent_lock_keys` | runtime infrastructure | advisory lock key | 維持 |
| `reflection_runs` | audit / work item | Reflection Session、固定Event窓、Session共通入力断面、全体結果 | Session共通snapshotの唯一の所有者にする。status / plan / retryは維持 |
| `reflection_attempts` | audit / work item | targetごとの実行状態とprovider出力 | `agent_id`を削除。親入力の複写をselector / target設定へ置換。Tool trace JSONをrelationへ移す |
| `reflection_memory_batches` | audit / work item | Formation batchの状態とprovider出力 | `agent_id`を削除。入力はEvent ID群とbatch metadataだけにする |
| `reflection_tool_executions`（追加） | audit relation | Reflection read Toolの完全入出力 | attempt又はbatchにFKを持つrowとして追加し、JSON arrayを置換 |
| `reflection_resolutions` | audit | Runtimeによる根拠選択・採否 | `agent_id`を削除。bounded selected/rejected ID集合とscoreは監査JSONとして維持 |
| `concern_activities` | audit | State aggregate内Concernの履歴 | 維持。Concern tableなしでも活動履歴を追える |

### writer・reader・保持の境界

| record群 | writer | 通常reader | 保持・削除方針 |
|---|---|---|---|
| Agent / State / Memory / Background | domain repository / Commit Layer | Agent Core context、Reflection、tool port | Agent identityと現在Stateは継続保持。Memoryは既存のライフサイクルに従う |
| Event / Run / Tool / State Change | EventCommitRepository とTool executor | Debug trace、Experience Integration、監査 | Eventは不変。Run / Tool / State Changeは監査保持。旧Debug用の再構成はしない |
| Experience / Event subject / Projection | Experience Integration commit とembedding worker | Retrieval、Reflection、Debug trace | ExperienceはEventと同じ保持。Projectionは再生成可能で、hash不一致時は再embedding後に置換する |
| Prediction / G3 / Schedule / Outbox / Web | 各work-item repository / delivery worker | scheduler、tool port、Debug trace | 完了recordは運用保持期間後に別途cleanup。active / leased / pendingは削除しない |
| Reflection Session / Attempt / Batch / Resolution / Tool trace | ReflectionRepository | Reflection recovery、Debug trace | Session監査は保持。child input複写は親snapshotとselectorへ縮小する |
| runtime correlation / rate window / lock | RuntimeRepository | loop防止、rate limit、lock取得 | TTLまたはwindow終了後にcleanup。lock keyは再利用可能 |

目標状態では、全writerはinfrastructure repositoryだけが持つ。application service、Tool adapter、Debug UIは対応するport / readerを通じてアクセスし、`Pool` / `PoolClient`を直接受け取らない。この境界の実装は#040、既存runtime queryの移行は#044で完了する。

## 3. Event / Run / Experienceの参照モデル

```text
events ──1:many── agent_runs ──1:many── tool_executions
   │                    │
   │                    └──1:1── experience_integrations (provider artifact / commit status)
   │                                      │
   └──1:1── event_experiences ◀──────────┘
                  │
                  ├──1:many── event_subjects
                  └──1:1── event_projections (embedding index)
```

- `events`は一つの論理的な観測であり、`agent_runs`はその処理attemptである。一つのEventが複数Runを持ち得るが、Experience Integrationは成功commitしたRunにだけ一つ予約され、`event_experiences`はEventごとに一つだけ作る。
- `event_experiences`は`experience_integrations.output.experience`を抽出・検証した**意味表現の正**である。
- `experience_integrations.output`はproviderの構造出力を再現する**監査artifact**であり、Experienceと同じfieldが含まれても、意味モデルを直接読む通常readerには使わない。
- `event_projections`はExperienceの本文を複製しない。Retrievalは`event_projections → event_experiences → events`をjoinし、embedding、summary、facts、subject、kind、時刻、Agent所有権を取得する。
- G3 task repositoryによるEvent Projectionの直接作成は廃止する。G3 Eventを検索対象にする場合も、Experience Integrationを完了してEvent Experienceを形成した後にだけProjectionを作る。Experienceを形成しないG3 outputはEvent Retrievalの対象にしない。
- `tool-result`はEventではなく`tool_executions`の監査recordとする。通常EventのExperience summaryと成功RunのAgent Core resultが、次の認知処理に必要なTool結果の意味を担う。
- retryは新しい`agent_runs` rowとして記録する。失敗RunはExperience Integrationを予約しない。途中commit成功後に配送などが失敗した場合も、同じRunを再commitせずOutbox retryへ委譲する。

## 4. snapshotと監査の所有者

| 情報 | 正の保存先 | 再保存しない場所 |
|---|---|---|
| Event観測 | `events.observation` | Experience Integration input、派生表 |
| 通常Runの判断入力断面 | `agent_runs.input_snapshot` | `experience_integrations.input` |
| 通常Runの構造出力 | `agent_runs.result` | Event Experience / projection |
| Tool完全入出力 | `tool_executions` | `agent_runs.result`にTool本文を恒久複写しない |
| Experience Integration provider出力 | `experience_integrations.output` | Event Experience以外の意味表現 |
| Reflection Session共通入力 | `reflection_runs.input` | attempts / memory batches |
| Reflection target / batch provider出力 | `reflection_attempts.output` / `reflection_memory_batches.output` | `reflection_runs.output`には全体planだけを置く |
| Reflection Tool完全入出力 | `reflection_tool_executions` | attempts / batchesのJSON array |

この分離でも、監査に必要な時点の判断材料は失わない。子処理は親snapshotへの参照と、選んだEvent / Memory / 非公開handleのselectorを持つため、何を読んで何を決めたかを再構成できる。

## 5. Drizzle境界

### Drizzle query builderへ移す

- 通常のselect / insert / update / delete
- schema由来のFK、unique、index、check
- transaction、upsert、batch insert
- Agent State、Event transaction、Experience Integration、Memory、Outbox、scheduleの通常更新
- bootstrap / reset / debug reader / test fixtureのCRUD

### repository内のPostgreSQL専用`sql`として残す

- vector operator、hybrid rank、window function、CTEを用いるRetrieval / Reflection resolver
- `FOR UPDATE SKIP LOCKED`によるqueue / schedule claim
- advisory lock、`pg_try_advisory_lock`
- `date_trunc`を使うrate windowのatomic increment
- migration、rebaseline、one-off backfill / repair script

専用SQLも`Pool.query`を自由に呼ばず、Drizzle database transaction内の`execute(sql\`...\`)`に閉じる。application / Toolはportを呼び、PostgreSQL型をimportしない。

## 6. 移行手順

1. Drizzle schemaへ新relation、新FK、新index、冗長列を置換する新列を追加し、`pnpm db:generate`でDDL migrationを生成する。既存列・tableはこの段階でdropしない。
2. data migration scriptを追加する。scriptはdry-runを既定とし、`--apply`時だけDMLを実行する。対象はEvent subject relation、Projection embedding metadata、重複所有者列の整合性、未完了work itemの検証である。
3. scriptは、変換件数、skipped件数、参照不整合、未完了work item、embedding状態を出力して失敗時は非0終了する。旧Debug UI用のsnapshotは変換しない。
4. 新readerを追加する。過去のDebug UI履歴は対象外だが、新writerのEvent → Run → Tool → Experience traceを表示する。
5. writerを一度に切替え、新旧writerの並走を停止する。切替後、tool-result Event、冗長なEvent / Agent / Run所有者列、Experience Integration input複写へ書かない。
6. 実DBでReflection、通常Event、Tool、Outbox、recoveryを1回以上通し、新Event traceを確認する。
7. 旧readerと旧列をread pathから外し、保持期限を過ぎた後に別migrationでdropする。

rollbackはdrop前ならreader/writerを旧列へ戻せる。drop migration以後はDB backupからしか戻せないため、dropは独立した最終Issueにする。

## 7. 後続Issue案

1. **#039 正の永続化要件とアーキテクチャを更新する**：一次仕様・Requirements・Architecture・Test Strategyを承認済み設計へ更新する。
2. **#040 Drizzle runtime database基盤とrepository境界を導入する**：database factory、transaction、port、application / Toolからの`pg`除去の足場を作る。
3. **#041 Event / Run / Experience / Projectionを正規化する**：Event Subject relation、Projection縮小、Experience Integration input縮小、Event / Run / Tool writer・reader切替を行う。
4. **#042 Reflection監査snapshotとTool traceを正規化する**：親Session input、子selector、Reflection Tool execution relation、旧JSON backfillを移行する。
5. **#043 監査・作業itemの親参照を整理する**：Prediction / Run / Tool / Reflection childの導出可能所有者列、FK、indexを移行する。
6. **#044 通常CRUDをDrizzleへ移行しPostgreSQL専用queryを隔離する**：repositoryごとのquery置換と禁止境界を実装する。
7. **#045 実DB data migration・切替・保持期間検証を行う**：dry-run / apply script、新旧reader比較、writer切替、実DB検証、旧列drop準備を行う。

各実装Issueは前のschema / boundary Issueに依存する。#045はdropを含めず、dropは実運用で保持期間とbackfill検証が済んだ後に別Issueとする。

## 8. Event Projectionとsubjectの詳細設計

`event_experiences`は`event_id`、`integration_id`、`summary`、`facts`だけを持つ。`agent_id`と`occurred_at`は`events`から導出する。`subjects` JSONは削除し、検索用にだけ次のrelationを置く。

```text
event_subjects(event_id, subject_id)
primary key (event_id, subject_id)
```

- subjectの正は専用masterではなく既存の文字列IDである。これは`memory_subjects`と同じ所有権モデルであり、Agent / human以外を一律に外部キー化しない。
- writerはEvent observationのactorが`human`または`agent`である場合だけdeterministicに一件を作る。LLMによるsubject抽出はしない。
- `event_subjects`はsubject filterを使うEvent RAGだけが読む。actor不在のEventにはrowを作らず、subject filter時に候補から外れる。

`event_projections`は`event_id`、`embedding`、`embedding_status`、`embedding_model`、`embedding_dimension`、`embedding_error`、`embedding_last_attempt_at`、`content_hash`、timestampsだけを持つ。検索本文は常に`event_experiences.summary`であり、`content_hash`はそのSHA-256である。

- Experience作成時はsummary hashを計算し、Projectionのvectorを同じtransactionで保存できれば`ready`、失敗時は`pending`または`failed`にする。
- Experience summaryを修正するrepairは、Projection vectorをNULL、statusを`pending`、hashを新値へ更新する。readerは`ready`かつhash一致のvectorだけを使い、それ以外はkeyword / subject / recencyだけで順位付けする。
- embedding backfillはhash不一致、`pending`、`failed`を対象にし、成功時だけvectorとmodel / dimension / attempt時刻を更新する。

## 9. query inventoryとDrizzle割当て

以下は`src/`の直接query 240 call siteの完全なファイル単位inventoryである。`CRUD`はDrizzle query builder、`NATIVE`はrepository内のDrizzle `sql`、`ADMIN`は明示実行script / operationへ移す。各file内のcall siteは記載分類へ全て割当てる。

| file | calls | 割当て | 移行先 |
|---|---:|---|---|
| `application/legacy-prediction-normalization.ts` | 1 | ADMIN | prediction normalization script repository |
| `application/memory-evidence-normalization.ts` | 5 | ADMIN | data migration / repair repository |
| `application/memory-update.ts` | 4 | CRUD | MemoryUpdateRepository |
| `application/memory-write-service.ts` | 13 | CRUD 11 / NATIVE 2 | MemoryRepository、advisory transaction lock |
| `bootstrap/bot-host.ts` | 7 | CRUD 4 / NATIVE 3 | BootstrapRepository、advisory lock |
| `debug-ui.ts` | 1 | CRUD | DebugRepository |
| `event-transaction.ts` | 17 | CRUD 16 / NATIVE 1 | EventCommitRepository、schedule replacement batch |
| `postgres-agent-context-loader.ts` | 4 | NATIVE | AgentContextRepositoryのread model query |
| `postgres-background-experience-embedding.ts` | 5 | CRUD | BackgroundExperienceRepository |
| `postgres-experience-integration.ts` | 14 | CRUD 13 / NATIVE 1 | ExperienceIntegrationRepository、欠落Experience候補query |
| `postgres-g3-task-repository.ts` | 8 | CRUD | G3TaskRepository |
| `postgres-memory-embedding.ts` | 4 | CRUD | MemoryRepository |
| `postgres-memory-retriever.ts` | 1 | NATIVE | Memory retrieval query |
| `postgres-prediction-repository.ts` | 7 | CRUD | PredictionRepository |
| `postgres-reflection.ts` | 61 | CRUD 48 / NATIVE 13 | ReflectionRepository、RAG / cluster / stale-close / lock query |
| `postgres-retrieval-service.ts` | 2 | NATIVE | RetrievalRepository hybrid ranking |
| `postgres-runtime-persistence.ts` | 8 | CRUD 6 / NATIVE 2 | RuntimeRepository、atomic rate/correlation claim |
| `postgres-schedule-repository.ts` | 12 | CRUD 8 / NATIVE 4 | ScheduleRepository、lease claim / retry aggregate |
| `postgres-web-archive.ts` | 11 | CRUD 10 / NATIVE 1 | WebArchiveRepository、vector retrieval |
| `postgres.ts` | 7 | CRUD 4 / NATIVE 3 | Drizzle transaction、advisory lock、migration runner |
| `tools/agent-context-tools.ts` | 13 | CRUD 8 / NATIVE 5 | AgentContextRepository tool port |
| `tools/scheduled-task-tools.ts` | 4 | CRUD | ScheduledTaskRepository tool port |
| `operations/background-experiences.ts` | 5 | CRUD | BackgroundExperienceRepository |
| `operations/operations.ts` | 13 | CRUD | BootstrapRepository |
| `operations/reset-runtime.ts` | 13 | CRUD | RuntimeResetRepository |

`NATIVE`は生の`Pool.query`を残す意味ではない。Drizzle transactionの`execute(sql\`...\`)`としてrepository内に閉じる。`ADMIN`はruntimeの通常経路から除外し、dry-run / `--apply`を持つscriptだけが呼ぶ。

## 10. data migration mapping

| 旧所有 / field | 新しい正 | 変換 | 意図的な非移行・drop条件 |
|---|---|---|---|
| `agent_runs.agent_id` | `events.agent_id` | dry-runで全RunのAgent一致を検証。`--apply`は新reader用view / queryのみ切替 | 全件一致と新writer停止後にdrop |
| `tool_executions.event_id` | `tool_executions.run_id → agent_runs.event_id` | 全rowのEvent一致を検証。新readerはRun joinを使用 | tool-result Event読取りを止め、全row一致後にdrop |
| `tool_executions.result_event_id` とtool-result Event | `tool_executions` | 新writerは作らない。既存rowは監査保持 | 既存Debug UI表示は非対象。保持期限後に別Issueでdrop |
| `state_changes`のRun参照 | `agent_runs` | 変換不要。FK整合性を検証 | なし |
| `experience_integrations.agent_id/source_event_id/input` | `source_run_id → agent_runs → events` と`agent_runs` / `tool_executions` | pending / processing / failedを含め、RunとEventの存在・所有者一致を検証。新retry readerはRunから再構成 | input JSONは新writer切替後に保存しない。全未完了Integrationを処理・停止後にdrop |
| `event_experiences.agent_id/occurred_at/subjects` | `events` / `event_subjects` | 既存subjectsを`event_subjects`へdedupe insertし、Event所有者・時刻一致を検証 | relation件数一致後にdrop |
| `event_projections.content/agent_id/kind/subjects/occurred_at` | `event_experiences` / `events` / `event_subjects` | summary hashを計算。vectorが既存contentと一致する場合だけreadyとして引継ぎ、それ以外はpending | 新readerのjoin検索とbackfill成功後にdrop |
| `prediction_records.agent_id/source_event_id` | `source_run_id` | Run経由のAgent/Event一致を検証 | 新writer切替後、全row一致でdrop |
| `scheduled_tasks.source_event_id` | `source_run_id` | source Run存在を検証。scheduled/runningは不一致なら切替を中止 | 全active task完了または明示cancel後にdrop |
| `web_snapshots.source_event_id/tool_result_event_id` | `source_run_id + source_tool_call_id` | Tool executionとの一致を検証 | pending archive処理を完了後、tool-result Event読取り停止でdrop |
| Reflection child `agent_id/input/tool_executions` | parent Session / new Tool relation | #042で別script。Session / target / batchがpendingなら切替前にdrainまたは停止 | #042完了まで保持 |

data migration scriptは各mappingについて`scanned`、`convertible`、`applied`、`skipped`、`mismatched`、`active`をJSON出力する。`mismatched > 0`または`active > 0`で切替対象なら非0終了する。`--apply`は一つのmapping単位でtransactionを張り、DDLを行わない。
