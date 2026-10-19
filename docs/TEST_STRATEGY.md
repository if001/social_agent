# Test Strategy

本書は[`spec/`](../spec/)の概念と実装設計、[`AGENT_MOTIVATION_MODEL.md`](AGENT_MOTIVATION_MODEL.md)の動機・感情・行動モデルを、現在のコードでどう検証するかを定める。過去文書の `old_docs/` は対象外である。

## Test layers

### Unit / contract

- Self、State、Concern、Relationship、Memory、Final Meaning / Feeling、Agent Core outputのZod契約
- モデル向けflat schemaのfield説明、provider不要制約の除去、strict Domain outputへの変換
- ContextのAgent所有権、件数・文字列・推定token budget、Memory重複排除
- State Patchのupsert/remove、evidence、別Agent更新拒否
- Tool schema、権限、冪等性、call budget、同一入力反復、結果上限
- Recent Experience用Tool投影が400文字以内で識別signalを残し、巨大な入力・結果本文を含めないこと
- Recent ObservationがEvent metadataを重複保持せず、要点・非重複facts・必要な自律探索条件だけを残すこと
- Concern schedule、Scheduled Task、Reflection、Debug UIの読取り契約
- idle探索モードのEvent伝播、成功時の巡回、失敗時の維持
- 探索領域カタログの件数・重複検証、`distant`候補の上限制御、探索モード選択の具体化
- Agent Core入力でTool定義を二重投入しないこと、8,000推定token超過をwarningにしてprovider呼び出しを継続すること
- Reflectionのモデル向けfield説明、flat変更record、repair、入力token上限

### System

実modelと実DBを使わず、Runtime全体の決定論的な不変条件を確認する。

- Terminal、Discord、Agent間Message、各種Eventが同じAgent Loopを通る
- Agent Core出力からFinal Assessment、Desire、Action、Patchへの分離
- Tool continuation、複数Tool実績、Tool利用と発話判断が独立していること
- 未登録Tool callを失敗実績としてcontinuationへ返し、run全体をprovider障害にしないこと
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

- 入力「こんにちは。今日は少し話したいです。」に対し、Final Meaning / FeelingとDesire / Actionを確定し、空でない応答をOutboxへ保存・配送する。
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

## 要件とテストの対応

テスト名の先頭には、検証する ID を `FR-1:` の形式で書く。複数 ID は `FR-2, NFR-8:` のように列挙する。

### Functional requirements

| 要件 | レベル | テストファイル | 主な検証 |
|---|---|---|---|
| FR-1 | System | `tests/system/runtime-terminal.test.ts`, `tests/system/discord.test.ts` | 全 Event 種と UI が同じ Runtime を通る |
| FR-2 | System, Live | `tests/system/runtime-terminal.test.ts`, `tests/live/production-context-user-response.test.ts` | 単一経路の構築・検証・commit |
| FR-3 | Contract, Evaluation | `tests/contract/agent-harness.contract.test.ts`, `tests/evaluation/evaluation-runner.test.ts` | Final Assessment の分離 |
| FR-4 | Contract, System | `tests/system/tool-loop.test.ts`, `tests/contract/agent-harness.contract.test.ts` | 同一 Deep Agent 内の Tool continuation |
| FR-5 | Contract, Unit | `tests/contract/agent-harness.contract.test.ts`, `tests/unit/domain-contracts.test.ts` | 旧経路・旧出力の不在 |
| FR-6 | Unit, Integration | `tests/unit/domain-contracts.test.ts`, `tests/unit/config-lifecycle.test.ts`, `tests/integration/persistence.test.ts` | Self の契約と初期化 |
| FR-7 | Unit, Integration | `tests/unit/domain-contracts.test.ts`, `tests/integration/persistence.test.ts` | State の契約と永続化 |
| FR-8 | Unit | `tests/unit/memory-context.test.ts`, `tests/unit/domain-contracts.test.ts` | Concern の契約と上限 |
| FR-9 | Contract, Unit, Live | `tests/contract/agent-harness.contract.test.ts`, `tests/unit/memory-context.test.ts`, `tests/live/ollama-user-response.test.ts` | Feeling の短期性と Assessment 引継ぎ |
| FR-10 | Unit, Integration | `tests/unit/domain-contracts.test.ts`, `tests/integration/persistence.test.ts` | Memory の契約と検索 |
| FR-11 | Contract, Live | `tests/contract/agent-harness.contract.test.ts`, `tests/live/ollama-user-response.test.ts` | Deep Agents 本番経路 |
| FR-12 | Contract, Evaluation | `tests/contract/agent-harness.contract.test.ts`, `tests/evaluation/evaluation-runner.test.ts` | flat schema と説明 |
| FR-13 | Contract | `tests/contract/agent-harness.contract.test.ts` | provider 制約の除去と Zod 再検証 |
| FR-14 | Contract, System, Live | `tests/system/invalid-output.test.ts`, `tests/contract/agent-harness.contract.test.ts`, `tests/live/ollama-user-response.test.ts` | repair と Tool 停止 |
| FR-15 | Contract, System, Integration | `tests/system/invalid-output.test.ts`, `tests/contract/agent-harness.contract.test.ts`, `tests/integration/persistence.test.ts` | repair 失敗時の非 commit |
| FR-16 | System, Contract | `tests/system/invalid-output.test.ts`, `tests/contract/agent-harness.contract.test.ts` | user-message の限定的 fallbackと自律Eventでの不適用 |
| FR-17 | System, Contract, Live | `tests/system/runtime-terminal.test.ts`, `tests/contract/discord-adapter.contract.test.ts`, `tests/live/ollama-user-response.test.ts` | respond の配送 |
| FR-18 | System, Unit | `tests/system/runtime-terminal.test.ts`, `tests/unit/domain-contracts.test.ts` | refuse の内容と basis |
| FR-19 | System, Contract, Unit | `tests/system/runtime-terminal.test.ts`, `tests/contract/discord-adapter.contract.test.ts` | notify-no-execution の配送 |
| FR-20 | Contract, System | `tests/contract/agent-harness.contract.test.ts`, `tests/system/runtime-terminal.test.ts` | Tool 利用と発話判断の独立 |
| FR-21 | Contract, System, Unit | `tests/contract/agent-harness.contract.test.ts`, `tests/system/runtime-terminal.test.ts`, `tests/unit/domain-contracts.test.ts` | no-external-action の理由 |
| FR-22 | Contract | `tests/contract/agent-harness.contract.test.ts` | 夜間の判断材料 |
| FR-23 | Unit, System, Evaluation | `tests/unit/agent-state-patch.test.ts`, `tests/unit/domain-contracts.test.ts`, `tests/system/invalid-output.test.ts` | Patch 対象の限定 |
| FR-24 | Unit, Integration, System | `tests/unit/agent-state-patch.test.ts`, `tests/integration/persistence.test.ts`, `tests/unit/scheduler.test.ts`, `tests/system/tool-loop.test.ts` | Concern 更新と schedule 同期 |
| FR-25 | Unit, Integration, System | `tests/unit/agent-prompts.test.ts`, `tests/unit/scheduler.test.ts`, `tests/unit/reflection.test.ts`, `tests/integration/persistence.test.ts` | Concern ライフサイクルと状態遷移 |
| FR-26 | Unit, System | `tests/unit/scheduler.test.ts`, `tests/unit/agent-prompts.test.ts`, `tests/system/self-drive-autonomy.test.ts` | idle 探索モード |
| FR-27 | Unit, System | `tests/unit/agent-prompts.test.ts`, `tests/system/self-drive-autonomy.test.ts` | 具体対象への着地 |
| FR-28 | Unit | `tests/unit/config-lifecycle.test.ts`, `tests/unit/scheduler.test.ts` | カタログ件数・重複・抽出 |
| FR-29 | Unit | `tests/unit/memory-context.test.ts` | Recent Experience との重複排除 |
| FR-30 | Unit, Contract | `tests/unit/memory-context.test.ts`, `tests/contract/agent-harness.contract.test.ts` | Recent Experience の内容 |
| FR-31 | Integration | `tests/integration/persistence.test.ts` | Memory の生成・保存 |
| FR-32 | System | `tests/system/tool-loop.test.ts`, `tests/system/invalid-output.test.ts` | 予算・schema・権限・反復の拒否 |
| FR-33 | Contract, Unit, Live | `tests/contract/agent-harness.contract.test.ts`, `tests/unit/tools.test.ts`, `tests/live/production-context-user-response.test.ts` | Tool 登録と実行 context |
| FR-34 | Contract, Unit | `tests/contract/agent-harness.contract.test.ts`, `tests/unit/tools.test.ts` | Tool 説明と入力 schema |
| FR-35 | Unit, System | `tests/unit/tools.test.ts`, `tests/system/tool-loop.test.ts` | 入力・権限・回数・冪等性・記録 |
| FR-36 | System | `tests/system/tool-loop.test.ts` | Tool Result の同一 loop 返却 |
| FR-37 | Unit, System | `tests/unit/tools.test.ts`, `tests/unit/text-extraction.test.ts`, `tests/system/invalid-output.test.ts` | 監査保存と Recent Experience 投影 |
| FR-38 | Contract | `tests/contract/agent-harness.contract.test.ts` | Tool 成否と通知判断の非結合 |
| FR-39 | Unit, System | `tests/unit/scheduler.test.ts`, `tests/system/internal-event.test.ts`, `tests/system/self-drive-autonomy.test.ts` | Event-driven な自律起動 |
| FR-40 | Unit, Integration | `tests/unit/scheduled-task-tools.test.ts`, `tests/unit/scheduler.test.ts`, `tests/integration/persistence.test.ts` | Scheduled Task の分離 |
| FR-41 | Unit, Integration | `tests/unit/reflection.test.ts`, `tests/unit/scheduler.test.ts`, `tests/integration/persistence.test.ts` | Reflection の maintenance 処理 |
| FR-42 | Unit, Integration, Live | `tests/unit/reflection-harness.test.ts`, `tests/integration/persistence.test.ts`, `tests/live/ollama-reflection.test.ts` | Reflection の構造化出力、backoff、24時間上限 |

### Non-functional requirements

| 要件 | レベル | テストファイル | 主な検証 |
|---|---|---|---|
| NFR-1 | Unit, Integration, System | `tests/integration/persistence.test.ts`, `tests/system/multi-bot.test.ts`, `tests/unit/memory-context.test.ts` | Agent 所有権と分離 |
| NFR-2 | Unit | `tests/unit/reflection.test.ts` | Self 変更の根拠 |
| NFR-3 | Unit, Integration | `tests/unit/memory-context.test.ts`, `tests/integration/persistence.test.ts` | Context の件数・長さ・token 上限 |
| NFR-4 | Contract, Unit | `tests/contract/agent-harness.contract.test.ts`, `tests/unit/reflection-harness.test.ts`, `tests/unit/memory-context.test.ts` | 4,500 / 8,000 token の境界 |
| NFR-5 | Contract, System, Unit | `tests/contract/agent-harness.contract.test.ts`, `tests/system/tool-loop.test.ts`, `tests/unit/ollama-provider.test.ts` | model call・Tool call・deadline |
| NFR-6 | Unit, Integration | `tests/unit/scheduler.test.ts`, `tests/integration/persistence.test.ts` | claim・lease・retry |
| NFR-7 | Integration, Evaluation, Unit | `tests/integration/persistence.test.ts`, `tests/evaluation/evaluation-runner.test.ts`, `tests/unit/operations.test.ts` | 監査記録と artifact |
| NFR-8 | Integration, Live | `tests/integration/persistence.test.ts`, `tests/live/production-context-user-response.test.ts` | transaction と一括 commit |
| NFR-9 | Contract, System | `tests/contract/message-queue.contract.test.ts`, `tests/system/runtime-terminal.test.ts`, `tests/system/recovery.test.ts` | retry・冪等性・Outbox |
| NFR-10 | Unit, Contract, Integration | `tests/unit/agent-send.test.ts`, `tests/contract/message-queue.contract.test.ts`, `tests/integration/persistence.test.ts` | lock・version・TTL・hop・rate limit |
| NFR-11 | Integration | `tests/integration/persistence.test.ts`, `tests/integration/reset-runtime.test.ts` | 現行 schema のみの保持 |
| NFR-12 | Unit | `tests/unit/debug-ui.test.ts` | 読取り専用 Debug UI |
| NFR-13 | Unit, Contract, Evaluation | `tests/unit/config-lifecycle.test.ts`, `tests/unit/logger.test.ts`, `tests/evaluation/evaluation-runner.test.ts` | secret の非表示 |

### Acceptance criteria

| 要件 | レベル | テストファイル | 主な検証 |
|---|---|---|---|
| AC-1 | System, Unit | `tests/system/invalid-output.test.ts`, `tests/unit/domain-contracts.test.ts` | schema・境界・非 commit |
| AC-2 | Live | `tests/live/ollama-user-response.test.ts`, `tests/live/ollama-reflection.test.ts` | 実 Ollama の応答と repair |
| AC-3 | Live | `tests/live/production-context-user-response.test.ts` | production-like E2E |
| AC-4 | Evaluation | `tests/evaluation/evaluation-runner.test.ts` | paired live evaluation |

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
