# Test Strategy

本書は[`spec/`](../spec/)の概念と実装設計、[`AGENT_MOTIVATION_MODEL.md`](AGENT_MOTIVATION_MODEL.md)の動機・感情・行動モデルを、現在のコードと追加設計でどう検証するかを定める。過去文書の `old_docs/` は対象外である。

本書では、会話由来MemoryをConversation Memory、生成済みの背景経験をBackground Experience、`memory-update` EventをMemoryUpdate Event、G1/G2の評価をpredictionEvaluation、Reflectionの計画をreflection planと呼ぶ。

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
- PredictionEvaluation、PredictionContext、MemoryIntent、memoryCandidatesのZod契約
- MemoryWriteServiceのcreate、update、no-op、Memory version楽観ロック
- Background ExperienceのSchema、時系列、現在のユーザーとの共有経験の不在
- 共通RetrievalServiceのvector、keyword、subject、recency順位付けとadapter
- memory-update Eventのpayload、intentIndex冪等性、部分commit禁止
- Reflection planのMemory、Self、Relationship、Concernごとのstatus
- G3の別DeepAgent出力とMainAgentへのmemoryIntents受け渡し

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
- G1/G2が応答後に予測し、1ターン遅れでpredictionEvaluationをMainAgentへ渡すこと
- predictionEvaluationがFeelingを出力せず、MainAgentだけがMeaning / Feelingを確定すること
- memory-update EventがLLMを呼ばず、MemoryUpdateHandlerで処理されること
- user-message、memory-update、G3、reflectionの優先順位と強制中断なしの協調制御
- memory-update Eventの冪等性、部分commit禁止、失敗時の応答非巻き戻し
- G3の遅延実行、MainAgent再判断、通知必須の例外
- Reflectionの部分成功、blocked、失敗対象だけの再試行

ここでいうシナリオtestは複数componentを通すSystem testであり、実Ollama、実PostgreSQL、外部Discordをすべて使うEnd-to-End testとは区別する。

### PostgreSQL integration

実migrationを一時的な隔離schemaへ適用し、repositoryとtransaction境界を検証する。state version競合、rollback、advisory lock、Conversation Memory検索、Background Experience検索、Reflection commit、Concern schedule、Tool trace、Recent ExperienceへのTool本文非混入、Outbox冪等性、Runtime resetを含む。Prediction Evaluation、Prediction Context、memory mutation、memory-update Eventの冪等性、Memory version競合、Reflectionの対象別statusも検証する。

接続設定はtest processが実行時に読み込めるが、値を標準出力やartifactへ表示しない。testは専用schemaだけを作成・破棄し、共有schemaの検証データへ依存しない。

### Live Ollama

`tests/live/ollama-user-response.test.ts`は実Ollamaを呼び、次を確認する。

- 入力「こんにちは。今日は少し話したいです。」に対し、Final Meaning / FeelingとDesire / Actionを確定し、空でない応答をOutboxへ保存・配送する。
- 初回に意図的な`action: string`不正出力を与え、実Ollamaによるrepair後にEvent、Receipt、Outboxを一度だけcommitする。

`tests/live/ollama-reflection.test.ts`は、実OllamaがReflectionのproduction構造化出力経路から有効なmaintenance結果を返すことを確認する。

`tests/live/ollama-prediction.test.ts`は、実OllamaがG1/G2のproduction構造化出力経路から予測候補、predictionEvaluation、rememberを返し、Feelingを出力しないことを確認する。G3が有効な場合は仮説評価とmemoryIntentsを返すことも確認する。

### Production-like text UI E2E

`tests/live/production-context-user-response.test.ts`は外部Discordを使わず、UI非依存のユーザー入力経路を検証する。隔離PostgreSQLへ実migrationとAgent初期値を投入し、本番composition、Context Builder、本番Tool群、Deep Agent、実Ollama、Runtime transaction、Outbox dispatcherを通す。

入力は「動作確認です。日本語で一文だけ返答してください。」で、空でない`agent-response`、Message receipt、完了Run、未送信Outbox、配送先を確認する。続けて`idle` Eventを入力し、自律Actionと2件目のcommitを確認する。このtestとDiscord本番の差は外部adapterとDiscord APIだけであり、ContextとToolの有無ではない。予測を有効にした構成では、応答後のG1/G2、memory-update Event、Background Experienceの検索、MainAgentのrememberが同じproduction compositionで動くことも確認する。

Live testはproviderとモデルの非決定性を含む。失敗を単なる揺らぎとして成功扱いせず、構造化出力、timeout、Context予算、Tool loopのどの境界で失敗したかをlogから判定する。

### Evaluation

同一Observationに状態差だけを与えるpaired scenarioを反復し、Action、Tool利用、配送、次Stateをartifactへ保存する。少なくとも次を対象にする。

- praise / criticism: MemoryとRelationshipによるMeaning・Feeling・Action差
- boredom: MoodによるAction差
- refusal: 競合Concernによる受諾・拒否差
- curiosity: ConcernとMemoryによる自律Tool利用差
- individuality: 異なる経験から形成されたSelf Storyと行動差
- desire-handoff / desire-stale / desire-satisfied: previousDesireの直近性・満足性によるDesire採用差
- prediction-error: 予測誤差の有無でFeeling、Desire、Actionが変わる
- prediction-key: 同じ予測誤差でもSelf、Disposition、Concern、Relationship、Background Experienceで反応が変わる
- memory-update-effect: Memoryのcreate、update、no-opの後、同じような状況の次のpredictionEvaluationが変わる
- non-sycophancy: 予測誤差が迎合ではなく、確認、検索、信念維持、拒否、距離取りへつながる
- memory-update-latency: user-messageがmemory-updateやreflectionで待たされない

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
| FR-43 | Unit, Contract, Integration, Evaluation | `tests/unit/memory-context.test.ts`, `tests/contract/agent-harness.contract.test.ts`, `tests/integration/persistence.test.ts`, `tests/evaluation/evaluation-runner.test.ts` | previousDesire の引き継ぎ、上限、時間差scenario |
| FR-9 | Contract, Unit, Live | `tests/contract/agent-harness.contract.test.ts`, `tests/unit/memory-context.test.ts`, `tests/live/ollama-user-response.test.ts` | Feeling の短期性と Assessment 引継ぎ |
| FR-10 | Unit, Integration | `tests/unit/domain-contracts.test.ts`, `tests/integration/persistence.test.ts` | Memory の契約と検索 |
| FR-46 | Unit | `tests/unit/agent-prompts.test.ts` | 共通の社会基盤、深さ、質問0件、機微の境界 |
| FR-47 | Unit | `tests/unit/agent-prompts.test.ts` | Event skillの読み込み、skill_read、ルーティング |
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
| FR-44 | Unit, Integration, System | `tests/unit/reflection.test.ts`, `tests/unit/reflection-harness.test.ts`, `tests/integration/persistence.test.ts`, `tests/system/tool-loop.test.ts` | Reflection の新規Concern作成、根拠、上限、空一覧で非作成 |
| FR-26 | Unit, System | `tests/unit/scheduler.test.ts`, `tests/unit/agent-prompts.test.ts`, `tests/system/self-drive-autonomy.test.ts` | idle 探索モード |
| FR-27 | Unit, System | `tests/unit/agent-prompts.test.ts`, `tests/system/self-drive-autonomy.test.ts` | 具体対象への着地 |
| FR-28 | Unit | `tests/unit/config-lifecycle.test.ts`, `tests/unit/scheduler.test.ts` | カタログ件数・重複・抽出 |
| FR-29 | Unit | `tests/unit/memory-context.test.ts` | Recent Experience との重複排除 |
| FR-30 | Unit, Contract | `tests/unit/memory-context.test.ts`, `tests/contract/agent-harness.contract.test.ts` | Recent Experience の内容 |
| FR-31 | Integration | `tests/integration/persistence.test.ts` | Memory の生成・保存 |
| FR-32 | System | `tests/system/tool-loop.test.ts`, `tests/system/invalid-output.test.ts` | 予算・schema・権限・反復の拒否 |
| FR-33 | Contract, System, Unit, Live | `tests/contract/agent-harness.contract.test.ts`, `tests/system/tool-loop.test.ts`, `tests/unit/tools.test.ts`, `tests/live/production-context-user-response.test.ts` | Tool 登録、Event種別ごとの公開、実行 context |
| FR-34 | Contract, Unit | `tests/contract/agent-harness.contract.test.ts`, `tests/unit/tools.test.ts` | Tool 説明と入力 schema |
| FR-35 | Unit, System | `tests/unit/tools.test.ts`, `tests/system/tool-loop.test.ts` | 入力・権限・回数・冪等性・記録 |
| FR-36 | System | `tests/system/tool-loop.test.ts` | Tool Result の同一 loop 返却 |
| FR-37 | Unit, System | `tests/unit/tools.test.ts`, `tests/unit/text-extraction.test.ts`, `tests/system/invalid-output.test.ts` | 監査保存と Recent Experience 投影 |
| FR-38 | Contract | `tests/contract/agent-harness.contract.test.ts` | Tool 成否と通知判断の非結合 |
| FR-39 | Unit, System | `tests/unit/scheduler.test.ts`, `tests/system/internal-event.test.ts`, `tests/system/self-drive-autonomy.test.ts` | Event-driven な自律起動 |
| FR-40 | Unit, Integration | `tests/unit/scheduled-task-tools.test.ts`, `tests/unit/scheduler.test.ts`, `tests/integration/persistence.test.ts` | Scheduled Task の分離 |
| FR-41 | Unit, Integration | `tests/unit/reflection.test.ts`, `tests/unit/scheduler.test.ts`, `tests/integration/persistence.test.ts` | Reflection の maintenance 処理 |
| FR-42 | Unit, Integration, Live | `tests/unit/reflection-harness.test.ts`, `tests/integration/persistence.test.ts`, `tests/live/ollama-reflection.test.ts` | Reflection の構造化出力、backoff、24時間上限 |
| FR-45 | Unit | `tests/unit/scheduler.test.ts`, `tests/unit/agent-prompts.test.ts` | idle の再開間隔と通知の扱い |
| FR-48 | System | `tests/system/prediction-loop.test.ts` | 応答後の予測、1ターン遅れの誤差評価 |
| FR-49 | Contract | `tests/contract/prediction-contracts.test.ts` | 1 callの予測・評価・remember・G3判断 |
| FR-50 | Contract, System | `tests/contract/prediction-contracts.test.ts`, `tests/system/prediction-loop.test.ts` | Feeling非出力とMainAgentのAssessment確定 |
| FR-51 | System | `tests/system/g3-event.test.ts` | G3別DeepAgent、遅延、memoryIntents |
| FR-52 | System | `tests/system/g3-event.test.ts` | MainAgent再判断、G3の通知例外 |
| FR-53 | Integration | `tests/integration/background-experience.test.ts` | 別Store、不変、起動中の上書きなし |
| FR-54 | Unit, Integration | `tests/unit/background-experience.test.ts`, `tests/integration/background-experience.test.ts` | Schema、AI/if001プロフィール、段階、共有経験の不在、実在人物、分布 |
| FR-55 | Unit, Integration | `tests/unit/retrieval-service.test.ts`, `tests/integration/persistence.test.ts` | 共通rankingとadapter |
| FR-56 | Unit, Contract | `tests/unit/memory-intent.test.ts`, `tests/contract/prediction-contracts.test.ts` | Memory kind限定、Patch/Concern経路 |
| FR-57 | Unit, Integration | `tests/unit/memory-write-service.test.ts`, `tests/integration/persistence.test.ts` | create/update/no-op、version、直接INSERT不在 |
| FR-58 | System | `tests/system/memory-update-event.test.ts`, `tests/system/g3-event.test.ts` | 専用Handler、LLMなし、G3はMainAgentのrememberで適用 |
| FR-59 | System | `tests/system/memory-update-event.test.ts`, `tests/system/g3-event.test.ts` | 優先順位、強制中断なし |
| FR-60 | System, Integration | `tests/system/reflection-partial.test.ts`, `tests/integration/persistence.test.ts` | status、blocked、失敗対象の再試行 |
| FR-61 | System, Integration | `tests/system/memory-update-event.test.ts`, `tests/integration/persistence.test.ts` | intentIndex冪等、部分commit禁止 |
| FR-62 | Unit, Contract | `tests/contract/prediction-contracts.test.ts` | predictionContextの内容と所有権 |
| FR-63 | Contract, System | `tests/contract/prediction-contracts.test.ts`, `tests/system/prediction-loop.test.ts` | deadline、call予算、失敗時の継続 |
| FR-64 | Contract, Unit | `tests/contract/prediction-contracts.test.ts`, `tests/unit/domain-contracts.test.ts` | 旧後処理の不在、単一MemoryWriteService |

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
| NFR-8 | Integration, Live | `tests/integration/persistence.test.ts`, `tests/live/production-context-user-response.test.ts` | MainAgentの一括commitとmemory-updateの分離 |
| NFR-9 | Contract, System | `tests/contract/message-queue.contract.test.ts`, `tests/system/runtime-terminal.test.ts`, `tests/system/recovery.test.ts` | retry・冪等性・Outbox |
| NFR-10 | Unit, Contract, Integration | `tests/unit/agent-send.test.ts`, `tests/contract/message-queue.contract.test.ts`, `tests/integration/persistence.test.ts` | lock・version・TTL・hop・rate limit |
| NFR-11 | Integration | `tests/integration/persistence.test.ts`, `tests/integration/reset-runtime.test.ts` | 現行 schema のみの保持 |
| NFR-12 | Unit | `tests/unit/debug-ui.test.ts` | 読取り専用 Debug UI |
| NFR-13 | Unit, Contract, Evaluation | `tests/unit/config-lifecycle.test.ts`, `tests/unit/logger.test.ts`, `tests/evaluation/evaluation-runner.test.ts` | secret の非表示 |
| NFR-14 | Unit | `tests/unit/memory-context.test.ts`, `tests/contract/prediction-contracts.test.ts` | predictionContextと背景経験の所有権・budget |
| NFR-15 | Unit, Integration | `tests/unit/memory-write-service.test.ts`, `tests/integration/persistence.test.ts` | 直列化、version、冪等性 |
| NFR-16 | Contract, System | `tests/contract/prediction-contracts.test.ts`, `tests/system/prediction-loop.test.ts` | deadline、試行回数、call予算、失敗分離 |
| NFR-17 | Integration, System | `tests/system/memory-update-event.test.ts`, `tests/system/reflection-partial.test.ts`, `tests/integration/persistence.test.ts` | 監査記録と再試行 |
| NFR-18 | System | `tests/system/memory-update-event.test.ts`, `tests/system/g3-event.test.ts` | user-message優先、下位Eventの開始抑制 |
| NFR-19 | Unit, Integration | `tests/unit/background-experience.test.ts`, `tests/integration/background-experience.test.ts` | YAML検証、段階順序、AI/if001プロフィール、共有経験不在、実在人物、分布、非上書き |

### Acceptance criteria

| 要件 | レベル | テストファイル | 主な検証 |
|---|---|---|---|
| AC-1 | System, Unit | `tests/system/invalid-output.test.ts`, `tests/unit/domain-contracts.test.ts` | schema・境界・非 commit |
| AC-2 | Live | `tests/live/ollama-user-response.test.ts`, `tests/live/ollama-reflection.test.ts` | 実 Ollama の応答と repair |
| AC-3 | Live | `tests/live/production-context-user-response.test.ts` | production-like E2E |
| AC-4 | Evaluation | `tests/evaluation/evaluation-runner.test.ts` | paired live evaluation |
| AC-5 | System, Unit | `tests/system/tool-loop.test.ts`, `tests/unit/agent-prompts.test.ts` | Event種別ごとのTool公開と実行拒否 |
| AC-6 | Unit, Contract, Integration, System, Evaluation | `tests/unit/reflection.test.ts`, `tests/unit/reflection-harness.test.ts`, `tests/contract/agent-harness.contract.test.ts`, `tests/integration/persistence.test.ts`, `tests/system/tool-loop.test.ts`, `tests/evaluation/evaluation-runner.test.ts` | previousDesire（満足済み含む）と Reflection 新規Concern |
| AC-7 | Unit | `tests/unit/scheduler.test.ts`, `tests/unit/agent-prompts.test.ts` | idle の沈黙・通知後の再開と通常経路 |
| AC-8 | Unit | `tests/unit/agent-prompts.test.ts` | 共通の社会基盤と質問しない選択 |
| AC-9 | Unit | `tests/unit/agent-prompts.test.ts` | 実効system prompt 4,500 |
| AC-10 | Unit | `tests/unit/agent-prompts.test.ts` | Event種別ごとのskillルーティング |
| AC-11 | Contract, System | `tests/contract/prediction-contracts.test.ts`, `tests/system/prediction-loop.test.ts` | 予測、1ターン遅れ、Feeling非出力 |
| AC-12 | Unit, Integration | `tests/unit/memory-write-service.test.ts`, `tests/integration/persistence.test.ts` | create/update/no-op、version、直接INSERT不在 |
| AC-13 | System | `tests/system/memory-update-event.test.ts` | LLMなし、専用Handler、冪等性、部分commit禁止、user-message優先 |
| AC-14 | Integration | `tests/integration/background-experience.test.ts` | 別Store、不変、共有経験不在、共通Retrieval |
| AC-15 | System, Integration | `tests/system/reflection-partial.test.ts`, `tests/integration/persistence.test.ts` | 対象別status、blocked、再試行 |
| AC-16 | System | `tests/system/g3-event.test.ts` | G3別DeepAgent、遅延、再判断、通知例外 |
| AC-17 | Contract | `tests/unit/memory-intent.test.ts`, `tests/contract/prediction-contracts.test.ts` | Memory kind限定、Patch/Concern経路 |
| AC-18 | Contract, System | `tests/contract/prediction-contracts.test.ts`, `tests/system/prediction-loop.test.ts` | ownership、budget、旧後処理不在、call予算 |

FR-48〜FR-64、NFR-14〜NFR-19、AC-11〜AC-18は追加設計の受入要件である。対応するtest fileは実装時に追加するため、実装完了まではtrace_checkで未参照の警告が残る。

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
- Conversation Memoryへの直接INSERTがなく、MemoryWriteServiceとversion楽観ロックを経由している。
- predictionEvaluation、memory-update Event、Background Experience、Reflectionの部分成功が対応するsuiteで検証されている。
- 実model対応を変更した場合はLive Ollamaとproduction-like E2Eを実行する。
- 行動差を主張する場合は、反復paired live evaluation artifactと集計を保存する。
