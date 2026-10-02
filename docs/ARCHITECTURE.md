# Architecture

## 1. 目的と前提

本書は `REQUIREMENTS.md` を満たすシステム構成、責務境界、データフロー、永続化、障害処理、配置方法を定義する。

主な前提は次のとおりである。

- 1つの長時間稼働Node.jsプロセスを、1つのbotおよび1つのAgent個体に対応させる。
- 別のbotは、Agent ID、Discord資格情報、Queue宛先等を変えた同一構成のプロセスとして起動する。
- 各botプロセスはRuntime、Scheduler、Agent Harness、Terminal Adapter、Discord Adapterを内包する。
- PostgreSQL + pgvector、ローカルOllama Embedding、共有Queueディレクトリは複数botから利用し、LLM推論にはOllama Cloudを利用する。
- Web検索とページ取得には `SIMPLE_CLIENT_BASE_URL` で指定された既存Web Toolサービスを利用する。
- 外部からAgentへの入力とAgentから外部への出力は、宛先付きの双方向Message Queueで抽象化する。
- Internal Event、Time Event、Tool Result、Long-term ReviewはAgent Runtime内部で処理し、外部Queueへ戻さない。
- 実装言語はTypeScript、境界検証はZod、DBアクセスはDrizzle ORMを使用する。

## 2. Architecture原則

### A-01: DomainをFrameworkから分離する

Self、Disposition、Memory、Intention、Long-term Review等のドメイン型とルールは、Deep Agents、LangChain、Discord、Drizzle等の型に依存させない。外部ライブラリはAdapter内に閉じ込める。

### A-02: Portを所有する側を明確にする

Application / Domain層が必要とする契約をPortとして定義し、Infrastructure層が実装する。UI、Queue、LLM、Embedding、Memory Retrieval、Tool、Clock、ID生成はPort越しに利用する。

### A-03: 外部Messageと内部Eventを分ける

外部Messageは配送、再試行、宛先解決が必要なためQueueを通す。Internal EventとTool Resultは同一Runtime内の制御フローであり、Queue配送の対象にしない。

### A-04: LLMは提案し、Runtimeが確定する

LLMはSubjective Meaning、状態更新、Memory、Intention、Actionを提案する。RuntimeはZod Schema、権限、参照整合性、状態version、ループ上限を検証し、DB transactionで確定する。

### A-05: 配送はat-least-once、処理は冪等にする

ファイルQueueはMessageを失わないことを優先し、同一Messageが再配送される可能性を許容する。RuntimeとUI AdapterはMessage IDを使って重複処理を防ぐ。

## 3. System Context

```mermaid
flowchart LR
    User[Owner]
    Terminal[Terminal Adapter]
    Discord[Discord Adapter]
    Queue[(Addressed File Queue)]
    BotA[Bot Process A]
    BotB[Bot Process B]
    Postgres[(PostgreSQL + pgvector)]
    OllamaCloud[Ollama Cloud Chat]
    OllamaLocal[Local Ollama Embedding]
    WebTool[Web Tool Service]
    Web[Web]
    Files[Allowed Directories]

    User --> Terminal
    User --> Discord
    Terminal <--> Queue
    Discord <--> Queue
    Queue <--> BotA
    Queue <--> BotB
    BotA <--> Postgres
    BotB <--> Postgres
    BotA <--> OllamaCloud
    BotB <--> OllamaCloud
    BotA <--> OllamaLocal
    BotB <--> OllamaLocal
    BotA --> WebTool
    BotB --> WebTool
    WebTool --> Web
    BotA <--> Files
    BotB <--> Files
```

Terminal AdapterとDiscord Adapterは同じbotプロセス内で動作するが、Agent RuntimeとはQueue Portを介して通信する。図では論理的な境界を示している。

## 4. Layerと依存方向

```text
Domain
  ├── Agent state and value objects
  ├── Event / Observation / Action
  ├── Memory / Intention / Candidate
  └── Validation rules independent from I/O
        ▲
        │
Application
  ├── AgentRuntime
  ├── ContextBuilder
  ├── StateUpdateService
  ├── LongTermReviewService
  ├── Scheduler
  └── MessageRouter
        ▲
        │ ports
Infrastructure
  ├── DeepAgentsAdapter
  ├── Ollama adapters
  ├── Drizzle repositories
  ├── AddressedFileQueue
  ├── Terminal / Discord adapters
  └── Web / File / AgentCommunication tools
        ▲
        │
Bootstrap
  └── config load, dependency wiring, lifecycle
```

依存は外側から内側への一方向とする。DomainとApplicationはInfrastructureの具象クラスをimportしない。

## 5. 主要コンポーネント

### 5.1 Bootstrap / Bot Host

1つのbotプロセスを組み立て、終了まで管理する。

責務:

- `.env.sample`、`.env`、`process.env`から設定を読み、Zodで検証する
- Agent IDに対するPostgreSQL advisory lockを取得する
- DB接続、Queue、Ollama、Tool Registry、UI Adapterを構築する
- Queue consumer、Scheduler、Discord接続、Terminal入力を開始する
- SIGINT / SIGTERM時に新規受付を止め、処理中Eventを完了または再配送可能な状態へ戻す
- advisory lockと外部接続を解放する

同じAgent IDで2プロセスが起動した場合、後から起動したプロセスは処理を開始せず終了する。

### 5.2 Message Queue

Agent Runtimeへの外部入力と外部向け出力を配送する。

```ts
type Destination =
  | { type: "agent"; id: string }
  | { type: "terminal"; id: string }
  | { type: "discord"; id: string }
  | { type: "external"; id: string }

type MessageEnvelope = {
  schemaVersion: 1
  id: string
  source: Destination
  destination: Destination
  kind:
    | "user-message"
    | "agent-message"
    | "agent-output"
    | "external-event"
    | "delivery-error"
  payload: unknown
  correlationId?: string
  causationId?: string
  replyTo?: Destination
  attempt: number
  createdAt: string
  availableAt?: string
}

interface MessageQueue {
  publish(message: MessageEnvelope): Promise<void>
  consume(
    destination: Destination,
    handler: (message: MessageEnvelope) => Promise<void>,
  ): Promise<QueueSubscription>
}
```

`payload`は`kind`ごとのZod Schemaで検証する。Queue実装固有のack / nackは`consume`の内側でhandlerの成否へ対応させ、Application層へ漏らさない。

### 5.3 UI Adapter

UI固有入力をMessageへ変換し、UI宛てMessageを表示または送信する。

```ts
interface UiAdapter {
  start(): Promise<void>
  stop(): Promise<void>
}
```

Terminal Adapter:

- 標準入力を`user-message`として`agent:{agentId}`へpublishする
- `terminal:{terminalId}`宛て出力をconsumeして表示する
- 対話開始時の`replyTo`をTerminal宛先に設定する

Discord Adapter:

- 設定されたguild、channel、user等のallowlistに一致するMessageだけを受理する
- Discord Message IDから安定したQueue Message IDを作り、重複受信を抑止する
- `replyTo`にchannelとthreadを解決できるDiscord宛先IDを設定する
- Discord宛て出力の送信失敗時はQueue handlerを失敗させ、再配送させる

新しいUIは、同じQueue契約に対してpublish / consumeするAdapterとして追加する。

### 5.4 Agent Runtime

1 Eventの処理を調停するApplication Serviceであり、LLMによる意味判断と機械的制約の境界となる。

責務:

- 外部MessageをDomain Event / Observationへ変換する
- Agent単位でEventを直列処理する
- Context Builderを呼び出す
- Agent Harnessを実行する
- Tool Loopの回数、実行時間、利用可能Toolを制限する
- Agent Core Outputを検証する
- 状態、Memory、Intention、Candidate、Event logをtransactionで保存する
- 外部向けActionを宛先付きQueueへpublishする
- Internal Event、Time Event、Tool ResultをRuntime内で再投入する

外部Message consumerのconcurrencyはbotごとに1とする。長時間Tool実行中も同じAgentの別Eventを並行処理しない。

### 5.5 Context Builder

Agent Harnessへ渡す入力を組み立てる。

```ts
interface ContextBuilder {
  build(input: {
    agentId: string
    observation: Observation
    contextBudget: ContextBudget
  }): Promise<AgentCoreInput>
}
```

次を選択する。

- IdentityとShared / Initial Disposition
- Observationに関連するAcquired Disposition、Values、Role、Self Narrative
- 現在有効なEmotion、Mood、Drive、Desire、Intention
- Observationのsubjectに関係するSocial Context
- hybrid retrievalで取得したMemory
- 登録済みTool定義
- Runtimeの残りstep数、deadline、ファイル許可範囲等の制約

長期状態や全Memoryを無条件に投入しない。各カテゴリに件数上限を設け、最終的にmodelのContext budget内へ収める。

### 5.6 Agent Harness

Deep Agentsを利用してLLM reasoningとTool Loopを行う。

```ts
interface AgentHarness {
  run(input: AgentCoreInput, limits: RunLimits): Promise<AgentCoreResult>
}
```

`DeepAgentsAdapter`は次を担う。

- `AgentCoreInput`からsystem promptとmessagesを構築する
- Tool RegistryのToolだけをLangChain Toolへ変換して登録する
- API key付きOllama Cloud Chat ModelをDeep Agentsへ注入する
- 各Tool callとresultをRuntime traceへ通知する
- step上限とdeadlineを強制する
- 最終結果を`AgentCoreOutputSchema`でparseする
- Deep Agents / LangChain固有のmessage、tool、state型をDomain型へ変換する

Deep Agentsの組み込みMemory、filesystem、subagent機能は、明示的に採用したもの以外をドメイン状態の正本として使わない。特にSelf、Disposition、Intention、Memory、Long-term CandidateはPostgreSQL側を正本とする。

Ollama Cloudのchat modelはTool callingと要求する構造化出力を満たすものを設定する。接続先、API key、modelはそれぞれ `OLLAMA_BASE_URL`、`OLLAMA_API_KEY`、`OLLAMA_CHAT_MODEL` から読み取る。起動時に認証を含む簡単なcapability checkを行い、満たさない場合はbotをready状態にしない。

### 5.7 Tool Registry

利用可能なToolを起動時に固定する。

```ts
interface AgentTool<TInput, TResult> {
  readonly name: string
  readonly description: string
  readonly inputSchema: z.ZodType<TInput>
  execute(input: TInput, context: ToolExecutionContext): Promise<TResult>
}

interface ToolRegistry {
  list(): readonly AgentTool<unknown, unknown>[]
  get(name: string): AgentTool<unknown, unknown> | undefined
}
```

必須Tool:

- `web_search`: `SIMPLE_CLIENT_BASE_URL` の `POST /list` へ `{ q, k }` を送り、`query`、`k`、rank付きの`title`、`url`、任意の`snippet`と`published_date`を返す
- `web_fetch`: 同じサービスの `POST /page` へ `{ url }` を送り、取得した各documentの`url`、`title`、Markdown本文を返す
- `file_read` / `file_write` / `file_delete`: 許可root配下だけを操作する
- `agent_send`: 別Agent宛ての`agent-message`をQueueへpublishする

Toolは個別承認なしで実行する。未知のTool名は拒否する。コード実行、shell、任意外部API、カレンダーは登録しない。

File Toolは入力pathを絶対pathへ正規化し、`realpath`で許可root配下にあることを確認する。新規ファイルは最も近い既存親の`realpath`を検証する。symlinkを使ったroot外アクセスを拒否する。

Web Tool Adapterは `docs/web_tool.md` のrequest / responseをZodで検証し、timeout、response size、service errorを共通Tool errorへ変換する。Agentが指定するpage URLはHTTP / HTTPSだけを許可する。Web取得先へのnetwork制約とredirect検証はWeb Toolサービス側の責務であり、本システムは信頼するservice endpoint自体を `SIMPLE_CLIENT_BASE_URL` で固定する。

### 5.8 Memory Service

Memory保存と検索を担当する。

```ts
interface MemoryRepository {
  save(memory: Memory): Promise<void>
  findByIds(agentId: string, ids: string[]): Promise<Memory[]>
}

interface MemoryRetriever {
  retrieve(query: MemoryQuery): Promise<RetrievedMemory[]>
}

interface EmbeddingProvider {
  embed(text: string): Promise<number[]>
  dimensions(): number
}
```

`OllamaEmbeddingAdapter`は `OLLAMA_EMBEDDING_BASE_URL` のローカルOllamaを使ってMemory contentとqueryをembeddingする。modelと期待dimensionは `OLLAMA_EMBEDDING_MODEL` と `OLLAMA_EMBEDDING_DIMENSION` から読み、返却vectorの次元を保存前に検証する。Chat用のOllama Cloud接続やAPI keyは使用しない。検索は次を組み合わせる。

1. `agent_id`による個体分離
2. Memory type、related subject、Intention、時刻範囲等のmetadata filter
3. PostgreSQL全文検索によるlexical score
4. pgvectorによるsemantic similarity
5. 新しさと明示的なsignificanceを含む順位調整
6. 種別ごとの上限とContext budgetによる切り詰め

scoreは検索順位のために使用し、Agentの価値判断や人格の数値Rewardには使わない。

Embedding modelまたは次元数を変更する場合に再生成できるよう、各embeddingにmodel IDとdimensionを記録する。

### 5.9 State Update Service

Agent Coreの提案を検証し、transactionで適用する。

検証内容:

- Agent Core Output全体のZod parse
- 変更可能なtargetとoperationのallowlist
- Shared DispositionとIdentity等、通常Eventから変更できない領域の拒否
- 参照するMemory、Intention、subjectが同じAgentに属すること
- 長期状態を通常更新案から直接変更していないこと
- `agent_state.version`が読み取り時と一致すること

更新時はEvent log、状態更新、Memory、Intention、Candidate、Tool traceを1 transactionで保存する。version不一致時は古い提案を適用せず、現在状態からEventを再処理するかdead-letterに移す。

### 5.10 Scheduler

botプロセス内で、そのAgentだけを対象に定期評価する。

責務:

- `next_review_at`を迎えたActive Intentionの再評価
- 持続するDriveの再評価
- 保留Candidateがある場合のLong-term Review起動
- Mood等の時間経過による再評価機会の生成

SchedulerはDomain EventをRuntimeへ直接渡す。Queueへpublishしない。多重起動はAgent advisory lockと、各対象レコードの`next_review_at`更新transactionで防ぐ。

### 5.11 Long-term Review Service

通常Agent Loopとは別のprompt / modeで長期状態を再解釈する。

入力:

- 現在のSelf NarrativeとAcquired Disposition
- pending Candidate
- Candidateが参照するSelf-related Memory
- 関係するSocial Context

出力はKEEP、UPDATE、MERGE、DROPの判断、更新後の値、理由、根拠Memory IDを含む。Zodで検証後、長期状態更新、Candidateの解決状態、Self Change Memoryを同一transactionで保存する。

単純追加よりMERGEを優先する。Review後も長期状態が設定上限を超える場合は、意味を維持するcompactionを再度提案させる。

## 6. 外部Messageと内部Event

### 6.1 Queueを通るもの

- Terminal / DiscordからのUser Message
- Agent AからAgent Bへの情報伝達
- 将来追加する外部システム由来Event
- AgentからTerminal / Discord / 将来の出力先へのAction
- UI配送失敗に関するdead-letter対象Message

### 6.2 Queueを通らないもの

- Tool Result
- Intention review用Internal Event
- persistent DriveやMemory recallに基づくInternal Event
- Time Event
- Long-term Review Trigger
- State validation result

これらは1つのbotプロセス内でRuntimeが生成し、必要な永続記録だけをPostgreSQLへ保存する。

## 7. Message Queueのファイル実装

### 7.1 配置

標準実装`AddressedFileQueue`は、共有可能なQueue rootに宛先ごとのspoolを作る。

```text
queue-root/
  agent__agent-a/
    pending/
    processing/
    dead-letter/
  discord__bot-a/
    pending/
    processing/
    dead-letter/
  terminal__bot-a/
    pending/
    processing/
    dead-letter/
```

ファイル名は`availableAt_timestamp-messageId.json`とし、1ファイルに1 Envelopeを保存する。宛先IDはpathとして安全な文字列へencodeし、Queue root外を指せないようにする。

### 7.2 Publish

1. EnvelopeをZodで検証する。
2. 同じ宛先ディレクトリ内にUUID付きtemp fileを排他的に作成する。
3. JSONを書き込み、必要に応じてfile descriptorをsyncする。
4. temp fileを`pending`内の最終名へatomic renameする。
5. 同じMessage IDの最終ファイルが存在する場合は成功済みとして扱う。

共有Queue rootは、atomic renameと複数プロセスからの排他的file createを保証する同一host上のfilesystemを前提とする。NFS等の意味論が異なるfilesystemは標準構成の対象外とする。

### 7.3 Consume / Ack / Retry

1. consumerは自宛先のdueな`pending`ファイルを列挙する。
2. `processing`へのatomic renameに成功したconsumerだけがclaimする。
3. handler成功後、配送済み記録をPostgreSQLへ保存し、processing fileを削除する。
4. 一時失敗時はattemptと`availableAt`を更新し、backoff後の名前で`pending`へ戻す。
5. attempt上限、Schema不正、恒久エラー時は理由metadataとともに`dead-letter`へ移す。
6. 起動時にlease timeoutを超えた`processing`ファイルを`pending`へ戻す。

Queueはat-least-once deliveryとする。`message_receipts`の`(destination, message_id)` unique constraintにより、RuntimeとUI Adapterで副作用を冪等化する。

### 7.4 将来の差し替え

`MessageQueue` Portを維持し、Graphile Worker、pg-boss、Redis、外部broker等へ交換できる。HTTP Event Ingressは今回実装せず、将来`POST /events`をEnvelopeへ変換して`publish`するInbound Adapterとして追加する。

## 8. 主なデータフロー

### 8.1 User Messageから応答まで

```mermaid
sequenceDiagram
    participant UI as UI Adapter
    participant Q as Message Queue
    participant R as Agent Runtime
    participant C as Context Builder
    participant H as Deep Agents Adapter
    participant DB as PostgreSQL

    UI->>Q: publish(user-message, destination=agent)
    Q->>R: consume envelope
    R->>DB: check receipt and load state version
    R->>C: build observation context
    C->>DB: state and hybrid memory retrieval
    C-->>R: AgentCoreInput
    R->>H: run(input, limits)
    H-->>R: output + tool trace
    R->>DB: validate and transactionally persist
    R->>Q: publish(agent-output, destination=replyTo)
    R-->>Q: handler success
    Q->>UI: consume output
    UI-->>Q: delivery success
```

通常応答の宛先は入力Envelopeの`replyTo`を使う。`correlationId`は対話全体、`causationId`は直前MessageまたはEventを指す。

### 8.2 Tool Loop

```text
Agent Harness
  → registered Tool call
  → Runtime Tool Adapter validates input and limits
  → Tool executes
  → Tool Result is recorded
  → result returns directly to Agent Harness
  → next reasoning step
  → final AgentCoreOutput
```

Tool Resultは外部Queueへpublishしない。各callは`tool_executions`へ記録し、同じrun内の新しいObservationとしてDeep AgentsのTool Loopへ返す。

### 8.3 bot間通信

```text
Agent A
  → agent_send({ destinationAgentId: B, content })
  → Queue: destination=agent:B, kind=agent-message
  → Agent B Runtime
  → External Event / Observation
  → BのMemoryへ「Aから伝達された情報」として保存
```

Agent AのMemoryをBへ複製しない。返信が必要な場合は`replyTo=agent:A`を使う。連続したbot間通信は各runのstep上限、correlation単位のhop上限、Message TTLで停止する。

### 8.4 自律行動

```text
Scheduler
  → due Intention / pending Candidateを検出
  → RuntimeへInternal / Time Eventを直接渡す
  → Context Builder
  → Agent HarnessまたはLong-term Review
  → DBへ状態を保存
  → 外部通知が必要なActionのみdefault destinationへpublish
```

自律Actionのdefault destinationはbot設定で0件以上指定する。指定がなければ状態とtraceだけを保存し、外部通知は行わない。

## 9. Agent Core契約

主要な入力は既存実装設計の`AgentCoreInput`を基礎にし、実行metadataを追加する。

```ts
type AgentCoreInput = {
  run: {
    runId: string
    eventId: string
    agentId: string
    occurredAt: string
  }
  observation: Observation
  self: RelevantSelf
  dynamicState: RelevantDynamicState
  socialContext: SocialContext[]
  memories: RetrievedMemory[]
  availableTools: ToolDefinition[]
  runtimeConstraints: RuntimeConstraint[]
}

type AgentCoreOutput = {
  subjectiveMeaning?: string
  stateUpdates: StateUpdateProposal[]
  memoryUpdates: MemoryProposal[]
  intentionUpdates: IntentionUpdate[]
  longTermCandidates: LongTermUpdateCandidateProposal[]
  action: AgentAction
}
```

Actionはrespond、tool、wait、refuse、no-actionを表現する。Deep AgentsがTool Loopを完了した後の最終Actionに加え、実行したTool traceもResultへ含める。

Schema不適合時は、同じraw outputを添えて構造修復を1回だけ試みる。再度失敗した場合は状態を変更せずrunを失敗させる。再試行回数は設定可能だが、無制限にしない。

## 10. 永続化設計

### 10.1 正本

PostgreSQLを次の正本とする。

- Agent FamilyとAgent個体設定
- Stable / Dynamic State
- Social Context
- Intention
- MemoryとEmbedding
- Long-term Update Candidate
- Eventとrunの追跡情報
- State changeとTool execution
- Message処理済み記録

ファイルQueueは未配送Messageの正本であり、配送完了後の監査記録はPostgreSQLを正本とする。

### 10.2 論理テーブル

| Table | 主な内容 |
|---|---|
| `agent_families` | Shared Disposition、共通Capability、base instruction |
| `agents` | Identity、family ID、Initial Individual Disposition、設定、active状態 |
| `agent_states` | Stable / Dynamic State、Self Narrative、version、更新時刻 |
| `social_contexts` | subjectごとの現在認識 |
| `intentions` | goal、reason、trigger、status、next review |
| `memories` | type、content、significance、occurredAt、embedding、embedding model |
| `memory_subjects` | Memoryとsubjectの関連 |
| `memory_intentions` | MemoryとIntentionの関連 |
| `long_term_candidates` | target、proposed value、status、reason |
| `candidate_evidence` | Candidateと根拠Memoryの関連 |
| `events` | Event、Observation、source、correlation、処理状態 |
| `agent_runs` | input state version、結果、開始・終了、失敗理由 |
| `state_changes` | target、operation、before、after、reason、run ID |
| `tool_executions` | tool、validated input、result / error、run ID |
| `message_receipts` | destination、message ID、処理結果、処理時刻 |
| `outbox_messages` | DB commit後にQueueへ配送する出力Envelope、配送状態、attempt |

自然言語状態はJSONBまたはtextで保持する。検索・整合性・ライフサイクルに使うID、type、status、時刻、versionは列として構造化する。

### 10.3 SchemaとMigration

- TypeScriptのDrizzle Schemaをアプリケーション管理テーブルのsource of truthとする
- Drizzle Kitでversion管理されたSQL migrationを生成・適用する
- pgvector extension有効化はcustom SQL migrationに含める
- DB insert / select SchemaはDrizzle SchemaからZod Schemaを生成し、必要なrefinementを追加する
- migrationはbot起動時に各プロセスが競合して実行せず、明示的なmigration commandで適用する

### 10.4 Transaction境界

1 Eventの確定では、次を1 transactionに含める。

- 未処理Messageであることの確認とreceipt予約
- Event / run記録
- `agent_states.version`を条件にした状態更新
- Memory、Intention、Candidate、State change、Tool traceの保存
- run完了とreceipt完了

外部向けQueue publishはDB transactionと同一atomic unitにできない。`outbox_messages`テーブルへ出力Envelopeを同じtransactionで保存し、process内Outbox DispatcherがFile Queueへpublish後にsentとする。これによりDB commit後のプロセスクラッシュで出力を失わない。

## 11. 同時実行と整合性

- PostgreSQL advisory lockをAgent IDから生成したkeyで取得し、同一Agentのbotプロセスを1つに限定する
- Agent入力Queueのconsumer concurrencyは1とする
- `agent_states.version`のoptimistic lockを最後の防御とする
- Message処理は`message_receipts` unique constraintで冪等化する
- 外部副作用を伴うToolは`run_id + tool_call_id`をidempotency keyとして受け取れる契約にする
- bot間Messageにはhop countとTTLを持たせ、上限超過時は処理せずdead-letterへ移す
- UI出力はoutboxとdelivery receiptで重複を検出する。Discordでは可能な範囲でMessage IDとの対応を保存する

## 12. Failure Handling

| Failure | 処理 |
|---|---|
| Queue Envelope不正 | consumeせずdead-letterへ移し、理由を記録 |
| bot停止中 | pending fileを保持し、再起動後に処理 |
| 処理中クラッシュ | lease timeout後にprocessingからpendingへ戻す |
| 重複配送 | receiptを確認し、副作用を再実行せずack |
| Ollama Cloud認証・一時障害 | 秘密値を記録せず、上限付きexponential backoff後にMessageを再配送 |
| ローカルOllama Embedding停止 | embedding対象を失敗または保留として識別可能にし、上限付きで再試行 |
| Web Toolサービス停止・不正response | 構造化した失敗結果をHarnessへ返し、Agentに再判断させる |
| LLM構造不正 | 1回だけ修復し、失敗時は状態未変更でrun失敗 |
| Tool入力不正 | Toolを実行せず、失敗Tool ResultとしてHarnessへ返す |
| Web / File Tool失敗 | 構造化した失敗結果をHarnessへ返し、Agentに再判断させる |
| DB transaction失敗 | rollbackし、Messageをretry可能にする |
| state version競合 | 提案を破棄し、最新状態からEventを再処理 |
| Discord送信失敗 | outbound Messageをbackoff付きで再配送 |
| 永続的な失敗 | attempt上限後にdead-letterへ移す |

Runtimeは失敗時に部分的な状態更新を残さない。Toolが外部副作用を完了した後にDB保存が失敗する可能性は、Tool idempotency keyとexecution logで扱う。

## 13. 設定

設定の優先順位は次のとおりとする。後の値が前の値を上書きする。

```text
.env.sample → .env → process.env
```

`.env.sample`は実行可能な既定値を持てるが、実資格情報をrepositoryへ保存しない。

主な設定群:

- bot: Agent ID、Family ID、bot instance ID
- UI: Terminal有効化、Discord token、allowlist、宛先ID
- Queue: root、poll interval、lease、retry、dead-letter、durability mode
- DB: connection URL、pool size
- Ollama Cloud Chat: `OLLAMA_BASE_URL`、`OLLAMA_API_KEY`、`OLLAMA_CHAT_MODEL`、timeouts
- Local Ollama Embedding: `OLLAMA_EMBEDDING_BASE_URL`、`OLLAMA_EMBEDDING_MODEL`、`OLLAMA_EMBEDDING_DIMENSION`、timeouts
- Runtime: max steps、deadline、tool call上限、message hop上限
- Context: category上限、token budget、retrieval top K
- Scheduler: scan interval、review interval
- Tool: file roots、`SIMPLE_CLIENT_BASE_URL`、Web timeout、response size
- Output: autonomous actionのdefault destinations

設定全体をZodで検証し、不足または矛盾がある場合は外部接続を開始する前に終了する。

## 14. Deployment

### 14.1 1 bot

```text
Bot Process
  ├── Agent Runtime
  ├── Scheduler
  ├── Deep Agents Adapter
  ├── Terminal Adapter (optional)
  └── Discord Adapter (optional)

Shared dependencies
  ├── PostgreSQL + pgvector
  ├── Local Ollama Embedding
  └── Queue root on local/shared host filesystem

External dependencies
  ├── Ollama Cloud Chat
  └── Web Tool Service
```

### 14.2 複数bot

同じbuild artifactを異なる設定で複数起動する。各プロセスは1つのAgent IDを所有する。Queue root、PostgreSQL、ローカルOllama Embedding、Ollama Cloud Chat、Web Tool Serviceを共有し、Queue destinationとDBの`agent_id`で分離する。

標準ファイルQueueは同一host上の複数プロセスを前提とする。別hostへ配置する場合は、MessageQueue Adapterをネットワーク対応brokerへ交換する。その際もRuntime、UI Adapter、Message Envelopeは変更しない。

### 14.3 Health

プロセス内部に次の状態を持つ。

- `starting`: config検証、migration version、Ollama Cloud Chat capability、ローカルOllama Embeddingのmodel / dimensionを確認中
- `ready`: Agent lock取得済みでQueueをconsume可能
- `degraded`: DiscordやWeb等、一部Adapterが一時利用不能
- `stopping`: 新規consumeを停止し処理中runをdrain中

HTTP health serverは今回実装しない。状態は構造化ログとTerminalへ出力する。

## 15. Observabilityと運用

- JSON structured logを標準出力へ出す
- logにはtimestamp、level、bot ID、agent ID、message ID、event ID、run ID、correlation IDを含める
- prompt全文、Memory全文、Tool結果全文のlog出力は設定で制御する。DB保存自体には情報種別の制限を設けない
- Ollama Cloud Chat、ローカルEmbedding、Web Toolサービスの呼び出し時間、Tool実行時間、Queue待ち時間、retry回数、dead-letter件数を区別して記録する
- dead-letterを一覧・再投入する管理CLIを用意する
- PostgreSQL backupとQueue root backupを同じ運用単位として扱う
- データ削除はbot停止後に所有者がDBとQueueを直接操作する。Agent単位削除では外部キー順序または管理SQLを使用する

## 16. Security境界

個人利用であっても、次はRuntimeの機械的制約とする。

- Discord入力は設定されたowner / guild / channelのallowlistで制限する
- Tool Registry外のToolを実行しない
- File Toolは許可root外を拒否する
- Web Tool Adapterはpage URL schemeを制限し、接続先を構成済み `SIMPLE_CLIENT_BASE_URL` に限定する
- `.env`、Discord token、`OLLAMA_API_KEY`をlogやAgent Contextへ渡さない
- DB queryはDrizzleのparameterized queryを使用する
- Queue Envelope、LLM出力、Tool入力、DB境界をZodで検証する
- AgentのSelf Continuityや拒否判断はRuntime権限を変更できない

## 17. Requirementsへの対応

| Requirements領域 | Architecture上の実現箇所 |
|---|---|
| Agent Family・複数個体 | `agent_families`、`agents`、1 bot＝1 Agent process |
| 状態時間区分・更新案 | Domain State、Agent Core契約、State Update Service |
| Event / Observation / Meaning | Agent Runtime、Context Builder、Agent Harness |
| Memory・Retrieval | Memory Service、PostgreSQL全文検索、pgvector |
| Intention・自律行動 | Scheduler、Runtime内部Event |
| Long-term Review | Candidate tables、Long-term Review Service |
| Tool | Tool Registry、Deep Agents Adapter、各Tool Adapter |
| Terminal・Discord・将来UI | Addressed Queue、UI Adapter |
| bot間情報伝達 | `agent_send`、Agent宛てQueue Message |
| 永続化と再起動 | PostgreSQL、File Queue、Outbox、receipt |
| 不正出力・自己ループ防止 | Zod、RunLimits、hop / TTL、dead-letter |

## 18. 採用しない構成

- UIからAgent Runtimeを直接callbackで呼ぶ構成
- Tool ResultやInternal Eventを外部Queueへ往復させる構成
- 1プロセスが複数Agent個体を並行所有する構成
- Memory全文を毎回LLMへ渡す構成
- Deep Agentsの組み込みMemoryを人格状態の正本にする構成
- 複数botが単一append fileをlockなしで共有するQueue
- LLMがDBや永続状態を直接更新する構成
- HTTP Event Ingress、専用Queue server、分散brokerの今回実装

## 19. 将来の拡張点

- File QueueからGraphile Worker、pg-boss、Redis等へのAdapter交換
- HTTP、Web UI、音声UI等のInbound / Outbound Adapter
- botを別hostへ分散配置するためのnetwork broker
- Web検索Providerの追加
- Toolごとのsandboxまたは個別rate limit
- read replicaや専用worker等へのprocess分割

## 20. 参照

- `docs/REQUIREMENTS.md`
- `docs/web_tool.md`
- `spec/personal-agent-concept-design-restructured-v2.md`
- `spec/personal-agent-implementation-design-v2.md`
- [LangChain Deep Agents overview](https://docs.langchain.com/oss/javascript/deepagents/overview)
- [Drizzle ORM migrations](https://orm.drizzle.team/docs/migrations)
- [Drizzle ORM PostgreSQL extensions](https://orm.drizzle.team/docs/extensions)
- [Graphile Worker documentation](https://worker.graphile.org/docs)
