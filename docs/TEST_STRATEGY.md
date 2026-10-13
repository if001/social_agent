# Test Strategy

本書は[`spec/`](../spec/)の概念と実装設計、および[`note/agent-architecture-redesign-policy.md`](../note/agent-architecture-redesign-policy.md)の簡略化方針を、現在のコードでどう検証するかを定める。`docs/D3/`は対象外である。

## Test layers

### Unit / contract

- Self、State、Concern、Relationship、Memory、Event Assessment、Agent Core outputのZod契約
- モデル向けflat schemaのfield説明、provider不要制約の除去、strict Domain outputへの変換
- ContextのAgent所有権、件数・文字列・推定token budget、Memory重複排除
- State Patchのupsert/remove、evidence、別Agent更新拒否
- Tool schema、権限、冪等性、call budget、同一入力反復、結果上限
- Recent Experience用Tool投影が400文字以内で識別signalを残し、巨大な入力・結果本文を含めないこと
- Recent ObservationがEvent metadataを重複保持せず、要点・非重複facts・必要な自律探索条件だけを残すこと
- Concern schedule、Scheduled Task、Reflection、Debug UIの読取り契約
- idle探索モードのEvent伝播、成功時の巡回、失敗時の維持
- 探索領域カタログの件数・重複検証、`distant`候補の上限制御、cursorの成功時更新と失敗時維持
- Agent Core入力でTool定義を二重投入しないこと、8,000推定token超過をwarningにしてprovider呼び出しを継続すること
- Reflectionのモデル向けfield説明、flat変更record、repair、入力token上限

### System

実modelと実DBを使わず、Runtime全体の決定論的な不変条件を確認する。

- Terminal、Discord、Agent間Message、各種Eventが同じAgent Loopを通る
- Event AssessmentからDesire、Action、Patchへの引渡し
- Tool continuation、複数Tool実績、Tool利用と発話判断が独立していること
- `respond` / `refuse` / `notify-no-execution`のOutbox保存と配送再試行
- 自律Eventが具体的Tool実行も配送可能Actionもなく成功しない
- 初回不正・repair成功時は1回だけcommitする
- 初回とrepairがともに不正なら成功commit、Receipt、Outboxを作らずfailureだけを残す
- user-messageの`action: string`既知誤出力は空でないfallback応答へ復旧する
- crash recovery、重複受信、複数Agent分離、Runtime制限
- Reflection連続失敗時の指数backoff

ここでいうシナリオtestは複数componentを通すSystem testであり、実Ollama、実PostgreSQL、外部Discordをすべて使うEnd-to-End testとは区別する。

### PostgreSQL integration

実migrationを一時的な隔離schemaへ適用し、repositoryとtransaction境界を検証する。state version競合、rollback、advisory lock、Memory検索、Reflection commit、Concern schedule、Tool trace、Recent ExperienceへのTool本文非混入、Outbox冪等性、Runtime resetを含む。

接続設定はtest processが実行時に読み込めるが、値を標準出力やartifactへ表示しない。testは専用schemaだけを作成・破棄し、共有schemaの検証データへ依存しない。

### Live Ollama

`tests/live/ollama-user-response.test.ts`は実Ollamaを呼び、次を確認する。

- 入力「テストです。日本語で一文だけ返答してください。」に対し、Event AssessmentとAgent Coreを通って空でない応答をOutboxへ保存・配送する。
- 初回に意図的な`action: string`不正出力を与え、実Ollamaによるrepair後にEvent、Receipt、Outboxを一度だけcommitする。

`tests/live/ollama-reflection.test.ts`は、実OllamaがReflectionのproduction構造化出力経路から有効なmaintenance結果を返すことを確認する。

### Production-like text UI E2E

`tests/live/production-context-user-response.test.ts`は外部Discordを使わず、UI非依存のユーザー入力経路を検証する。隔離PostgreSQLへ実migrationとAgent初期値を投入し、本番composition、Context Builder、本番Tool群、Deep Agent、実Ollama、Runtime transaction、Outbox dispatcherを通す。

入力は「動作確認です。日本語で一文だけ返答してください。」で、空でない`agent-response`、Message receipt、完了Run、未送信Outbox、配送先を確認する。続けて`idle` Eventを入力し、自律Actionと2件目のcommitを確認する。このtestとDiscord本番の差は外部adapterとDiscord APIだけであり、ContextとToolの有無ではない。

Live testはproviderとモデルの非決定性を含む。失敗を単なる揺らぎとして成功扱いせず、構造化出力、timeout、Context予算、Tool loopのどの境界で失敗したかをlogから判定する。

### Evaluation

同一Observationに状態差だけを与えるpaired scenarioを反復し、Action、Tool利用、配送、次Stateをartifactへ保存する。少なくとも次を対象にする。

- praise / criticism: MemoryとRelationshipによるMeaning・Feeling・Action差
- boredom: MoodによるAction差
- refusal: 競合Concernによる受諾・拒否差
- curiosity: ConcernとMemoryによる自律Tool利用差
- individuality: 異なる経験から形成されたSelf Storyと行動差

欠測、schema failure、timeout、期待方向に届かない効果量を成功へ含めない。自動testや単発live応答の成功だけで、人格らしさや状態差による行動差を実証済みとはしない。

## Standard verification

DBや外部modelを必要としない標準suite:

```sh
pnpm typecheck
pnpm lint
pnpm test
pnpm test:system
pnpm test:evaluation
```

隔離PostgreSQLを使うintegration suite:

```sh
node --env-file=.env ./node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts --passWithNoTests
```

実Ollamaと隔離PostgreSQLを使うlive suite:

```sh
pnpm test:live
```

`pnpm verify`はtypecheck、lint、unit / contract、integration、system、evaluationを順に実行するが、live suiteは含まない。DB schema変更時は`pnpm db:generate`でmigrationを生成し、隔離schemaで検証してから、明示的な許可を得て共有DBへ`pnpm db:migrate`を適用する。

## Release conditions

- 変更範囲に対応する自動suiteがすべて成功する。
- schema、migration、repository、prompt、文書の用語と不変条件が一致する。
- 不正出力、provider失敗、DB失敗の経路が部分commitを残さない。
- 旧互換経路をtestのためだけに残していない。
- 実model対応を変更した場合はLive Ollamaとproduction-like E2Eを実行する。
- 行動差を主張する場合は、反復paired live evaluation artifactと集計を保存する。
