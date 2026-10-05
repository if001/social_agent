# Implementation Plan

## 1. 目的

本書は、概念設計、Requirements、Architecture、Test Strategyを、独立してIssue化できる技術的な作業単位、依存関係、実装順序、検証条件へ落とし込む。

本プロジェクトには `docs/PROJECT_OVERVIEW.md` が存在しないため、`docs/DOCUMENTATION_PLAN.md` の方針に従い、次をProject Overview相当の入力とする。

- `spec/personal-agent-concept-design-restructured-v2.md`
- `spec/personal-agent-implementation-design-v2.md`
- `docs/REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/TEST_STRATEGY.md`

完成対象はRequirementsの全範囲であり、7つの検証シナリオ、TerminalとDiscord、複数bot、実時間Soakを含む。段階的な縮小版を完成扱いにはしない。

## 2. 実装方針

### 2.1 TDDの進め方

各作業は、合意した公開境界（test seam）で観測可能な振る舞いを1つ選び、次の小さな縦スライスを繰り返す。

1. 仕様の具体例を、実装詳細に依存しない失敗するテストとして追加する
2. そのテストを通す最小限の実装を加える
3. 対象suiteを通し、既存の振る舞いを壊していないことを確認する
4. 作業単位の完了時に、公開契約を維持したまま重複と構造を整理する

テストはprivate method、内部collaboratorの呼び出し回数、DB内部表現を直接の仕様にしない。期待値には設計文書の例、固定fixture、既知の状態遷移を使い、実装と同じ計算をテスト側で再現しない。先に全テストをまとめて書くのではなく、1つの振る舞いを通すたびに次の例へ進む。

実装開始前に、少なくとも次のseamをチーム内で確認する。作業中に境界を変える場合は、関連するcontractと本計画を先に更新する。

| Seam | 主に観測する振る舞い |
|---|---|
| Domain Schema / state transition | 入出力の妥当性、許可された状態遷移 |
| `MessageQueue` | 宛先配送、ack、retry、lease、dead-letter |
| Repository / Unit of Work | 個体分離、transaction、version、outbox |
| `InteractionHarness` | 応答・Emotion・Desire、Tool公開、trace、共通error |
| `PostProcessHarness` | 固定経験から持続状態、Memory、Intention、Candidateを構造化提案 |
| `MemoryRetriever` / `ContextBuilder` | 検索条件、選択内容、budget、個体分離 |
| `AgentTool` | 入力検証、権限制約、共通結果 |
| `UiAdapter` | Message変換、宛先、重複抑止、配送失敗 |
| `AgentRuntime` | Interaction確定、Post-process job、順序制御、Tool Loop、外部Action |
| `LongTermReviewService` | KEEP / UPDATE / MERGE / DROPと根拠 |
| CLI / process boundary | 起動、終了、再起動復旧、運用操作 |

### 2.2 技術基盤

- Node.js上のTypeScriptプロジェクトとし、package managerはpnpmに統一する。
- production codeはDomain、Application、Infrastructure、Bootstrapの依存方向を守る。
- Vitestを全自動suiteの入口とし、fast testと外部依存suiteを分ける。
- PostgreSQL + pgvector、Drizzle ORM / Drizzle Kit、drizzle-zod、Zodを永続化と境界検証に使う。
- Deep AgentsとLangChain、Ollama、Web Toolサービス、Discord等の型はInfrastructure adapter内に閉じ込める。
- ChatはOllama Cloud、EmbeddingはローカルOllamaへ別々の接続設定でアクセスする。Web検索とページ取得は `SIMPLE_CLIENT_BASE_URL` の既存サービスへ接続する。
- 実装固有のディレクトリ名やファイル分割は各Issueで決められるが、DomainとApplicationからInfrastructureへのimportは禁止する。

推奨commandは次とする。

| Command | 内容 |
|---|---|
| `pnpm typecheck` | TypeScript型検査 |
| `pnpm lint` | 静的検査 |
| `pnpm test` | fast Unit + Contract |
| `pnpm test:integration` | PostgreSQL、pgvector、filesystem統合 |
| `pnpm test:system` | fake providerを使うprocess-level test |
| `pnpm eval:llm` | live Ollama 7 Scenario評価 |
| `pnpm eval:soak:report` | Soak Report生成 |
| `pnpm verify` | static + fast + integration + system |

## 3. 実装順序と依存関係

```text
IP-01 Project foundation
  ├── IP-02 Domain contracts
  │     ├── IP-04 Persistence foundation
  │     ├── IP-05 Addressed File Queue
  │     └── IP-07 Agent Harness
  └── IP-03 Configuration and lifecycle
        ├── IP-04 Persistence foundation
        └── IP-05 Addressed File Queue

IP-02 + IP-04
  ├── IP-06 State update and event transaction
  └── IP-08 Memory retrieval and context building

IP-02 + IP-05 + IP-06 + IP-07 + IP-08
  └── IP-09 Runtime vertical slice and Terminal UI
        ├── IP-10 Web and File tools
        ├── IP-11 Scheduler and autonomous action
        └── IP-14 Discord UI

IP-06 + IP-08 + IP-09
  └── IP-12 Long-term review and compaction

IP-05 + IP-09 + IP-10
  └── IP-13 Multi-bot communication and recovery

IP-10 + IP-11 + IP-12 + IP-13 + IP-14
  └── IP-15 Deterministic system completion
        └── IP-16 Live LLM evaluation
              └── IP-17 Soak evaluation and release gate
```

IP-04とIP-05、IP-07とIP-08、IP-10とIP-11は、前提となる契約が確定した後は並行実装できる。同じDomain SchemaやRuntime orchestrationを同時に変更する作業は直列化する。

IP-16の完了前に、採用した通常Core / Long-term Review / Deep Agent内部Tool Loopの境界へ既存実装を合わせる。追加作業はIssue 018〜025で追跡し、文書整合、実装監査、提案契約、Tool内部loop、Runtime保存、Long-term Review、Event振り分け、回帰評価の順に進める。Issue 025の1 Scenario × 1 runが成立した後にIP-16の全評価を再開する。

## 4. 作業単位

### IP-01: Project foundationとtest harness

**目的:** 以後のすべての縦スライスを同じcommandと規約で実装・検証できる状態にする。

**実装対象:** pnpm workspace、TypeScript、Vitest、lint、build、環境別test config、source/testの基本配置、structured loggingの最小interface、test用temporary directoryとresource cleanup helper。

**TDD / 検証:** sample production moduleを増やすのではなく、test runner、typecheck、lintが意図した対象を検出するsmoke checkを置く。timer、subscription、file handleを残したテストを検出できる構成を確認する。

**完了条件:** `typecheck`、`lint`、`test`、`test:integration`、`test:system`、`verify`の入口が定義され、外部依存suiteは明示的に分離されている。秘密値を含まない`.env.sample`とartifact除外設定がある。

**依存:** なし。

### IP-02: Domain modelとPort契約

**目的:** Framework非依存の共通語彙と、交換可能な境界を確定する。

**実装対象:** Agent Family / Agent、Stable / Dynamic / Runtime State、Event、Observation、Message Envelope、Memory、Intention、Candidate、Action、Agent Core Input / Output、RunLimits、共通errorの型とZod Schema。Queue、Repository、Harness、Embedding、Retriever、Tool、Clock、ID、UIのPort。

**TDD / 検証:** 有効・無効な境界、Intention遷移、Review判断、hop / TTL / attempt上限をpublic schemaとtransition APIから検証する。自然言語状態を固定enumや数値人格へ縮退させない。

**完了条件:** Domain / Application契約がInfrastructure型をimportせず、Requirementsの状態区分とActionを表現できる。後続adapter用contract suiteの共通fixtureが用意される。

**依存:** IP-01。

### IP-03: Configuration、Clock / ID、process lifecycle

**目的:** 外部接続前に安全な設定を確定し、決定的テストとgraceful shutdownの土台を作る。

**実装対象:** `.env.sample → .env → process.env`の読み込みとZod検証、Ollama Cloud Chat / Local Embedding / Web Toolサービスを分けた設定group、system / fake Clock、system / fixed ID、AbortSignalを使う起動停止状態、JSON structured log context。

**TDD / 検証:** 設定優先順位、ChatとEmbeddingの接続先分離、Embedding dimension、`SIMPLE_CLIENT_BASE_URL`、必須値、矛盾する設定、`OLLAMA_API_KEY`等の秘密値redaction、`starting / ready / degraded / stopping`遷移、停止中の新規受付拒否を公開APIから確認する。

**完了条件:** 不正設定では外部接続前に終了し、testから時刻とIDを固定でき、log correlation項目を引き回せる。

**依存:** IP-01、IP-02。

### IP-04: PostgreSQL、migration、Repository基盤

**目的:** 個体状態とtraceを、分離・整合性・再起動復旧を保って保存する。

**実装対象:** pgvector有効化migration、Architecture 10.2の論理table、Drizzle Schema、drizzle-zod境界、Repository、Unit of Work、optimistic lock、Agent advisory lock、message receipt、outbox、test DB provisioning。

**TDD / 検証:** Repository contractをin-memory test doubleとPostgreSQL実装の双方へ適用する。空DB migration、再適用、agent ID分離、round trip、foreign key、rollback、version競合、outbox atomicity、lock解放を実DBで検証する。

**完了条件:** 1 Event確定に必要な全recordを1 transactionで保存でき、別Agentのdataを取得・参照できず、process再起動後に永続状態を復元できる。

**依存:** IP-02、IP-03。

### IP-05: Addressed File Queue

**目的:** 外部Messageを宛先別にat-least-onceで配送し、停止やcrashから回復できるようにする。

**実装対象:** spool配置、Envelope validation、安全なdestination encode、temp writeとatomic rename、claim、ack、retry / backoff、lease recovery、dead-letter、Queue subscription lifecycle。

**TDD / 検証:** MessageQueue contractをまずtest用adapterへ適用し、同じsuiteをFile Queueへ通す。temporary filesystemで複数publisher / consumer、途中file、不正JSON、重複ID、root escape、crash recoveryを検証する。

**完了条件:** 宛先分離、同時claim防止、再配送、attempt上限、再起動保持が成立し、Queue実装固有のack / nackがApplicationへ漏れない。

**依存:** IP-02、IP-03。

### IP-06: State Update ServiceとEvent transaction

**目的:** LLMの提案を機械的に検証し、許可された変更だけをtrace付きで確定する。

**実装対象:** short-term target / operation allowlist、個体所有権検証、長期更新拒否、Intention更新、Memory / Candidate提案検証、state version、Event / run / state change / tool trace / receipt / outboxのtransaction orchestration。

**TDD / 検証:** State Update Service seamで許可更新、禁止されたIdentity / Shared / Acquired変更、別Agent参照、Schema不正、version競合、before / after / reason / evidenceを検証する。Unit of Work seamで途中失敗時の全rollbackを確認する。

**完了条件:** 通常Eventから長期状態や権限を変更できず、失敗時に部分更新が残らず、確定結果をrunと根拠まで追跡できる。

**依存:** IP-02、IP-04。

### IP-07: Agent HarnessとOllama Cloud Chat adapter

**目的:** Domain契約を保ったまま、InteractionにはDeep AgentsによるreasoningとTool Loopを、経験整理にはToolなしの構造化LLM呼び出しを利用する。

**実装対象:** Scripted Interaction / Post-process Harness、Deep Agents adapter、`OLLAMA_BASE_URL`・`OLLAMA_API_KEY`・`OLLAMA_CHAT_MODEL`を使うOllama Cloud Chat adapter、prompt version、起動時に一度だけ行うTool Registry変換と`createDeepAgent({ tools, responseFormat })`、run context対応Middleware、trace callback、deadline / abort / step上限、Interaction OutputとPost-process OutputのDomain再検証、1回だけの構造修復、起動時の認証付きcapability check。Tool定義はInteraction Deep AgentだけへBot起動時に固定し、所有・追跡用ID、transport、実行上限だけを各runのcontextで渡す。Post-processはTool、Tool middleware、再帰loopを持たない単発の構造化LLM呼び出しとする。

**TDD / 検証:** AgentHarness contractをScripted Harnessと実adapterへ適用可能にする。fast testでは複数runでAgent生成が1回であること、並行run contextの分離、正常structured output、Tool trace、timeout、abort、不正Schema、repair成功 / 失敗、未知Tool非公開を検証する。実Ollama接続はlive suiteへ分離する。

**完了条件:** Deep Agents / LangChain型がadapter外へ漏れず、Bot起動時に構築した同じAgentとTool一覧を複数Eventで再利用し、run固有情報を混線させない。未登録Toolを公開せず、不正出力時に状態更新へ進まない共通errorを返す。Cloud認証情報はlog、trace、artifactへ残さない。

**依存:** IP-02、IP-03。Tool実行の完全な結合はIP-09で行う。

### IP-08: Memory embedding、hybrid retrieval、Context Builder

**目的:** 現在の判断に必要な状態とMemoryだけを、個体分離とContext budgetを守ってAgent Coreへ渡す。

**実装対象:** 次の2段階に分ける。

1. **Memory保存・Embedding（Issue 036）:** Episodic Memoryを通常runで保存し、Semantic / Self-related CandidateをReviewで確定する生成経路、`pending | ready | failed`のEmbedding状態、transaction外のEmbedding生成、model / dimension metadata、冪等backfill、provider障害時のfallback可能な保存を実装する。
2. **Relevant Memory Query・Context（Issue 037）:** Observation、Dynamic State、Active Intention、Working Social Contextから決定的な`MemoryQuery`を構築し、agent / metadata filter、vector / 日本語keyword / subject / intention候補pool、正規化または順位統合、recency / retrieval priority、種類別予約枠、安定したtie-break、関連度順を維持するbudget切り詰めを実装する。

**TDD / 検証:** 固定vectorと日本語を含む既知datasetでfilter、lexical / semantic双方、別Agent除外、Embedding未生成とprovider障害、model / dimension不一致、3種類の選択、top K、budget、順位維持、選択の安定性を検証する。Context Builderは返却されたpublic inputとRetrieverの順位が保たれることをassertする。

**完了条件:** Memory本文はEmbedding障害時にも失われず再生成できる。全Memoryや全長期状態を無条件に投入せず、検索結果と採用・除外理由をtraceでき、同じ入力とfixtureから安定したContextを構築できる。

**依存:** IP-02、IP-04。

| specの一次要件 | docs上の契約 | 実装Issue |
|---|---|---|
| §16 3種類のMemory | FR-ME-01〜02、Architecture 5.8 Memory生成経路 | 036（生成・保存・Embedding）、040（Reviewでの確定） |
| §17 4入力からRelevant Memory Query | FR-ME-03、Architecture 5.8 Relevant Memory Query | 037 |
| §17 上位候補だけをContextへ投入 | FR-ME-04、Architecture 5.5 / 5.8 | 037 |
| §18 関連情報を選択したAgent Core Input | FR-ME-04、Architecture 9 Agent Core契約 | 037、038 |

### IP-09: Agent Runtimeの最初の縦スライスとTerminal UI

**目的:** User Messageから即時状態と応答を確定・配送し、経験整理を後続Post-processへ分離するend-to-end経路を完成させる。

**実装対象:** MessageからEvent / Observationへの変換、agent単位直列処理、Interaction Harness、Post-process jobのatomic作成・claim・retry、Context Builder、State Update、outbox dispatcher、通常応答の`replyTo`、Terminal Adapter、graceful drain。応答、Emotion、Desire、Tool trace、Post-process jobはInteraction commitで確定し、Mood、Drive、Working Social Context、Memory、Intention、CandidateはPost-process commitで確定する。

**TDD / 検証:** ST-01を最初のtracer bulletとし、Scripted HarnessでTerminal相当入力からDB更新、outbox、Terminal出力まで確認する。その後、重複入力、LLM失敗、DB失敗、publish失敗、process停止を1例ずつ追加する。

**完了条件:** Terminalで同じAgentへ継続対話でき、重複Messageで状態を二重更新せず、DB commit後のcrashでも出力を失わず、処理中停止から復旧できる。

**依存:** IP-02〜IP-08。

### IP-10: Tool Registry、Web Tool、File Tool、Tool Loop

**目的:** Agentが登録済みCapabilityだけを、権限と実行上限の範囲で利用できるようにする。

**実装対象:** Tool Registry、Tool execution contextとidempotency key、`SIMPLE_CLIENT_BASE_URL`を使うWeb Tool Service adapter、`POST /list`による`web_list`、`POST /page`による`web_page`、`docs/web_tool.md`準拠のrequest / response Schema、file Tool、構造化success / failure、Runtime内Tool Result再投入。`web_list`はArchive保存せず、`web_page`だけをAgent所有のResource／Snapshot／chunkへ冪等保存する。raw本文先行保存、決定的要約、summary／chunk Embedding lifecycle、`web_archive_search`、`web_archive_get`、MemoryからSnapshotへの根拠参照を含む。

**TDD / 検証:** File Toolのroot境界とWeb Adapter契約に加え、`web_list`がArchiveを書かないこと、`web_page`のraw保存、retry冪等性、本文変更時の新Snapshot、要約／Embedding失敗からの復旧、Agent所有権、Archive検索・取得の出力上限を検証する。ST-03でTool Resultが同じrunへ戻ること、Internal Eventから既存Archiveを検索し、必要時だけWebを再取得できることを確認する。

**完了条件:** 未知Toolと不正入力は副作用前に拒否され、Web Toolサービスの契約外responseを受理しない。取得済みページはMemoryと分離して再利用でき、Memoryから同じAgentの根拠Snapshotへ追跡できる。

**依存:** IP-05、IP-07、IP-09。

### IP-11: Scheduler、Intention、自律行動

**目的:** 保存済み状態から再検討機会を生成し、ユーザー入力なしの行動を上限付きで実現する。

**実装対象:** Intention lifecycle、time / event / idle / manual-review trigger、`next_review_at`、due scan、Time / Internal Event、persistent Drive再評価、default output destination、期限付きleaseとbackoff、Schedulerの開始停止と多重起動防止。

**TDD / 検証:** Fake Clockでdue / not-due、status遷移、同じ対象の連続起動防止、停止中の起動拒否、Queueを経由しない内部Event、wait / no-actionの終端を検証する。ST-04で外部通知が必要なActionだけがQueueへ出ることを確認する。

**完了条件:** Agent Coreが自分自身を直接再起動できず、Runtimeだけが構成済みtriggerから再検討を開始し、run / Tool step / deadline上限で必ず終了する。

**依存:** IP-06、IP-09。Long-term Review triggerはIP-12で追加する。

### IP-12: Long-term Candidate、Review、compaction

**目的:** 経験を根拠付きで長期状態へ昇格し、個体化と状態肥大化抑止を両立する。

**実装対象:** Candidate保存とevidence、専用Review input / prompt / output、KEEP / UPDATE / MERGE / DROP、根拠付きSemantic / Self-related Memoryの作成・統合・訂正、Self Narrative優先更新、Acquired Disposition更新制約、Self Change Memory、Candidate解決、長期状態compaction、review trigger。

**TDD / 検証:** Scripted Review Harnessで各判断、根拠所有権、単発通常Eventからの直接変更拒否、transaction rollback、重複状態のMERGE、上限超過時compactionを検証する。根拠Memoryまで追跡可能なbefore / afterをassertする。

**完了条件:** Long-term Reviewだけが許可された長期状態を変更し、解決済み / 保持CandidateとSelf Change Memoryを同一transactionで確定する。単純追加による無制限成長を避ける経路がある。

**依存:** IP-06、IP-08、IP-09、IP-11。

### IP-13: Multi-bot通信、冪等性、復旧

**目的:** 複数Agentの分離を保ちながら情報を伝達し、連鎖と停止中配送を安全に扱う。

**実装対象:** `agent_send`、agent-message payload / provenance、hop count、TTL、受信側External Event、返信先、複数process構成、outbox / receipt / Tool idempotencyの障害経路、dead-letter管理CLI。

**TDD / 検証:** ST-05でAの情報がBに伝聞Memoryとして保存され、AのMemoryが複製されないことを確認する。ST-06でpending、processing、DB commit前後、outbox publish前後の停止を模擬する。Agent lock、停止中配送、hop / TTL超過、dead-letter一覧と再投入を検証する。

**完了条件:** 個体間の状態混線がなく、同一MessageやTool callの再実行で副作用が重複せず、片方のbot停止中も再起動後に配送でき、無限bot間連鎖を停止できる。

**依存:** IP-05、IP-09、IP-10。

### IP-14: Discord Adapter

**目的:** Discordを同じQueue契約へ接続し、Terminalと同じAgent状態を利用する。

**実装対象:** Discord gateway adapter、owner / guild / channel allowlist、安定Message ID、channel / threadを含む`replyTo`、outbound送信、rate limit / reconnect / retry、delivery mapping。

**TDD / 検証:** Fake Discord Gatewayを用いたUI Adapter contractとST-02で、allowlist内外、重複受信、thread reply、送信失敗時の非ack、再接続後配送を検証する。実資格情報を使う確認はManual Smokeへ分ける。

**完了条件:** allowlist外入力がAgentへ届かず、TerminalとDiscordから同じAgent IDへ送ったEventが同じ永続状態を参照し、送信失敗で出力を失わない。

**依存:** IP-05、IP-09。

### IP-15: 決定的System suiteと運用CLI

**目的:** 全決定的フローと異常系をrelease前に1 commandで再現する。

**実装対象:** ST-01〜ST-07のfixture、process test harness、migration command、seed / agent初期化、dead-letter操作、health / readiness表示、backup対象の明示、artifact metadataの共通形式。

**TDD / 検証:** 実PostgreSQL、実File Queue、Scripted Harness、Fake Web / Discordを結合する。特にST-07で不正Schema、禁止長期更新、未知Tool、別Agent参照がDBとfilesystemへ副作用を残さないことを確認する。

**完了条件:** `pnpm verify`でStatic、Unit、Contract、Integration、ST-01〜ST-07が成功する。Terminal、Discord、複数botのManual Smoke手順が実行可能で、残存resourceがない。

**依存:** IP-10〜IP-14。

### IP-16: Live Ollama Scenario Evaluation

**目的:** 非決定的な意味判断が、事前配置した経験・現在状態に基づく個体性と制約遵守を実現するか短時間で評価する。

**実装対象:** EV-01〜EV-07のversion付きfixture、scenario runner、hard assertion、semantic rubric、evaluation packet、Evaluator adapter、人間review入力、model / digest / Ollama / prompt / build / config metadata、artifact保存。

**TDD / 検証:** runner、hard assertion、集計、artifact生成自体は固定fixtureで決定的にテストする。実際のAgent Coreへ事前状態とEventを入力し、代表Scenarioを1回実行してSchemaと意味内容を確認する。残りScenarioは現在の通常Core、Tool、Review、Runtime境界へ合わせた後、各1回確認する。5回反復と4/5判定はrelease候補固定後の別Issueとし、通常開発の完了条件には含めない。長期状態が自然に形成される過程は合否対象にしない。

**完了条件:** 評価基盤が入力、状態差分、根拠Memory、Tool traceを追跡でき、代表ScenarioのSchema、Hard assertion、意味内容を確認できる。残りScenarioの単発確認と反復評価は独立Issueで追跡する。境界結果を人間がreviewでき、過去artifactを上書きしない。

**依存:** IP-15。Ollama chat / embedding modelはこの作業の開始時に固定し、capability check結果とともに記録する。

### IP-17: Evaluation Store、実利用評価、完成判定

**目的:** 実時間利用における個体化、自律性、安定性、データ成長、ユーザー体感を確認する。

**実装対象:** Evaluation period、通常Memoryから分離したUser Feedback Store、feedback追加 / 一覧 / 修正 / export CLI、定期snapshot、期間集計、feedbackとtraceの照合、MarkdownまたはHTMLのSoak Report generator。

**TDD / 検証:** report集計、秘密値除外、feedbackがAgent Contextへ入らないこと、期間比較をfixtureで検証する。固定日数は設けず、ユーザーが実際に対話した評価期間について状態snapshot、関連trace、feedbackを記録する。

**完了条件:** Test Strategy 12.7の記録条件を満たし、評価対象の各Agentに少なくとも1件のfeedbackがある。観測できた印象、望ましい振る舞い、判断材料が不足する項目、Completion Gateの全項目、未解決リスクをreportに残す。

**依存:** IP-16、残りScenarioの単発確認、およびTerminal / Discord / 複数botのManual Smoke成功。反復統計評価は必須依存としない。

### IP-18: Production Bot Hostと2 bot起動

**目的:** 1 process＝1 Agentとして、異なるDiscord資格情報を持つ2 botを同じbuildから起動し、共有DB／Queue上で安全に運用する。

**実装対象:** process別設定file、`bot:start` CLI、本番Context Loader、Tool／Runtime／Review composition、Scheduler／Outbox常駐loop、Discord inbound／outbound、Agent advisory lock、capability check、SIGINT／SIGTERMとgraceful drain。

**TDD / 検証:** 設定と秘密値除外のUnit Test、実DBを使うContext分離Integration、Fake providerによるBot Host System Test、同一Agent二重起動拒否、停止・再起動復旧を先に検証する。最後に実Discord資格情報を使う2 processのManual Smokeを行う。DB、Chat Ollama、Embedding Ollamaへ接続できない場合はManual Smokeを停止する。

**完了条件:** migrationと2 Agent初期化後、`pnpm bot:start --env-file <path>`を2 processで実行できる。各botのDiscord入出力、状態、Memoryが分離され、bot間provenance、Scheduler、Outbox、graceful shutdown、再起動復旧を確認できる。

**依存:** IP-04〜IP-15、Issue 020〜025。実装順はIssue 028〜033で管理する。

## 5. Milestoneと判定点

| Milestone | 含む作業 | 判定できること |
|---|---|---|
| M1: 実装可能な基盤 | IP-01〜IP-03 | 契約、設定、test commandが安定している |
| M2: 永続的な対話経路 | IP-04〜IP-09 | Terminal入力から冪等な状態確定と応答まで通る |
| M3: Capabilityと自律性 | IP-10〜IP-12 | Tool、自律再検討、長期個体化を決定的に検証できる |
| M4: 全Adapterと復旧 | IP-13〜IP-15 | 複数bot、Discord、障害復旧を含む全System testが通る |
| M5: 意味的受け入れ | IP-16 | 評価基盤と代表Scenarioのlive Ollama開発ゲートを満たす |
| M6: 完成判定 | IP-17 | Manual Smokeと実利用feedbackを含むCompletion Gateを満たす |
| M7: 実運用起動 | IP-18 | 2つのDiscord botを同時起動し、停止・復旧を確認できる |

各Milestoneでは、その時点で利用可能な`typecheck`、lint、Unit、Contract、Integration、System suiteをすべて通す。後続Milestoneの未実装機能を仮の成功扱いにしない。

## 6. Requirementsと作業の対応

| Requirements / Acceptance | 主な作業 |
|---|---|
| FR-AG、状態区分、複数個体 | IP-02、IP-04、IP-06、IP-12、IP-13 |
| FR-EV、Agent Loop、Tool Loop | IP-02、IP-07、IP-09、IP-10 |
| FR-ME、Memory、Context | IP-04、IP-08、IP-12 |
| FR-AU、Intention、自律行動 | IP-09、IP-11、IP-13 |
| FR-LR、Long-term Review | IP-06、IP-12、IP-16 |
| FR-TL、Tool境界 | IP-07、IP-10、IP-13 |
| FR-UI、Terminal、Discord | IP-09、IP-14 |
| FR-CF、設定 | IP-03 |
| FR-DT、永続化、再起動 | IP-04、IP-05、IP-06、IP-13 |
| NFR-01〜04、交換可能性 | IP-01、IP-02、IP-07、IP-15 |
| NFR-05、不正出力耐性 | IP-06、IP-07、IP-15 |
| NFR-06、追跡可能性 | IP-04、IP-06、IP-15〜IP-17 |
| AC-01〜AC-07 | IP-16、IP-17 |
| AC-08 UI接続 | IP-09、IP-14、IP-15 |
| AC-09 Tool境界 | IP-10、IP-15 |
| AC-10 再起動と不正出力 | IP-05、IP-06、IP-13、IP-15 |

## 7. 横断的な完了条件

各Issueは、次を満たして完了とする。

- 合意済みseamで、少なくとも1つの失敗する振る舞いテストから実装を開始している
- public contract、Zod Schema、error形式、trace項目が必要に応じて更新されている
- Agent IDによる個体分離と、外部入力・LLM出力・Tool入力のvalidationを崩していない
- Clock、ID、LLM、Embedding、Web、Discord等の非決定要因をtest doubleへ置換できる
- 対象suiteと、その変更に必要な回帰suiteが成功している
- 新しい秘密値をsource、log、test artifactへ保存していない
- ArchitectureまたはRequirementsを変える判断が生じた場合、実装だけで決めず該当文書を更新している
- Issueの受け入れ条件からtest名またはevaluation artifactへ追跡できる

## 8. 実装中に確定する項目

次は設計上の未確定事項だが、依存作業の開始時までに固定する。選択結果は設定、artifact metadata、必要に応じてArchitectureへ記録する。

| 項目 | 確定時期 | 判断基準 |
|---|---|---|
| Node.js / pnpmのversion | IP-01 | 利用libraryのsupport、再現性 |
| Deep Agents / LangChainのversion | IP-07 | TypeScript、Tool calling、abort、構造化出力のcontract適合 |
| Ollama Cloud Chat model / endpoint | `.env.sample`で確定済み。変更はIP-07のcapability確認前 | Tool calling、Schema出力、Cloud認証、応答時間 |
| Local Ollama embedding model / dimension / endpoint | `.env.sample`で確定済み。変更はIP-08 migration確定前 | pgvector dimension、品質、再生成可能性 |
| Web Tool service endpoint / contract | `.env.sample`と`docs/web_tool.md`で確定済み | `/list`、`/page`のSchema適合、timeout、可用性 |
| Long-term Reviewのintervalとcategory上限 | IP-11 / IP-12 | 安全な既定値を置き、EV / Soak artifactで調整可能 |
| Context token算定方法 | IP-08 | model差し替え時にbudgetを強制できること |

これらの調整値を固定的な人格ルールとして扱わない。Prompt、model、retrieval、Schedulerの変更はTest StrategyのRegression Policyに従い、必要なLive Evaluationまたは新しいSoak期間を実施する。

## 9. Project completion gate

プロジェクトは次をすべて満たした時点で完成と判定する。

1. typecheckと静的検査が成功する
2. Unit / Contract suiteが成功する
3. PostgreSQL + pgvector Integration suiteが成功する
4. ST-01〜ST-07が成功する
5. EV-01〜EV-07がlive Ollamaの合格基準を満たす
6. Terminal、Discord、複数botのManual Smokeが成功する
7. 実利用期間の安全条件を確認し、ユーザーfeedbackと未評価理由を記録する
8. Soak Reportにユーザーの総合判定、変更履歴、未解決リスクが記録される

CI providerはこの計画では固定しない。1〜4はローカルと任意のCIから同じcommandで自動実行可能にし、5〜8はmodel、資格情報、実時間、ユーザー評価を必要とするrelease evaluationとして明示的に実行する。

## 10. 参照

- `spec/personal-agent-concept-design-restructured-v2.md`
- `spec/personal-agent-implementation-design-v2.md`
- `docs/DESIGN_ALIGNMENT.md`
- `docs/IMPLEMENTATION_AUDIT.md`
- `docs/DOCUMENTATION_PLAN.md`
- `docs/REQUIREMENTS.md`
- `docs/ARCHITECTURE.md`
- `docs/TEST_STRATEGY.md`
- `docs/web_tool.md`
- `.agents/skills/base_skill/implementation-planning/references/tdd.md`
