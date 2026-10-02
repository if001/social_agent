# Goal State

## Goal

Requirementsを満たすシステム構成、責務境界、データフロー、保存方式、外部依存、障害処理、配置方法を実装可能な粒度で決定する。

## Deliverable

`docs/ARCHITECTURE.md`

## Scope

- TypeScriptによる小規模・個人利用の自律パーソナルエージェント
- Terminal UI、Discord bot UI、複数Agent、自律Event、3系統のTool
- Ollama Cloud Chat、ローカルOllama Embedding、PostgreSQL + pgvector、Drizzle、Zod
- Deep Agentsを利用するAgent harnessと、独自ドメインの責務分離

## Completion Criteria

- [x] 主要コンポーネントとinterface境界が明確である
- [x] Event、Tool、状態更新、Long-term Reviewのデータフローが明確である
- [x] 永続化Schemaと整合性・同時実行方針が明確である
- [x] 外部依存、障害処理、設定、配置方法が明確である
- [x] Requirementsの全項目を実現できる

## Decision Areas

### Agent harness
Status: resolved

Decision:
- TypeScript版Deep Agentsを採用する。
- Deep AgentsはLLM Tool Loopと実行harnessに限定する。
- Self、Disposition、Memory、状態遷移、Long-term Reviewはアプリケーション固有ドメインとして分離する。
- Deep Agents固有型はadapter内に閉じ込める。

Rationale:
- 公式TypeScript SDKはTool登録、長期Memory、差し替え可能なfilesystem backend、ファイル権限制御を備える。
- Requirements固有の人格状態とReview処理はDeep Agents組み込みMemoryと意味が異なる。

### 永続化
Status: resolved

Decision:
- PostgreSQL + pgvectorを採用する。
- Drizzle ORM / Drizzle KitをSchemaとMigrationに使用する。
- ZodおよびDrizzleのZod連携で境界データを検証する。

Rationale:
- 複数Agentの永続状態、Event追跡、Long-term Candidateの根拠関係、semantic Memory Retrievalが完成要件である。

### 実行プロセス
Status: resolved

Decision:
- Runtime、Scheduler、Discord Adapter、Terminal Adapterを単一の長時間稼働Node.jsプロセスにまとめる。
- 1プロセスセットを1つのbot / Agent個体に対応させる。
- 別個体はAgent ID、Discord資格情報等を変えた同一構成のプロセスを別途起動する。
- PostgreSQLとOllamaは複数botプロセスで共有する。

### bot間通信
Status: resolved

Known:
- botごとに独立したNode.jsプロセスを起動する。
- PostgreSQLは全botで共有する。
- 通信は受信側にとってExternal Eventとして処理する。

Decision:
- UI由来User Message、bot間情報伝達、将来のExternal Eventは宛先付きMessage Queueを通す。
- 標準EventQueueはbotごとのファイルベース実装とする。
- Agent Communication Toolは受信botのQueueへEventをpublishする。
- Queue Portにより、将来Graphile Worker等の既存Queueへ交換可能にする。
- HTTP Event IngressはPort / Adapterの拡張点だけを設け、今回の実装対象外とする。

### Eventの配置
Status: resolved

Decision:
- QueueはAgent Runtimeへの外部入口に限定する。
- Internal EventはRuntimeが保存済みIntention、Drive、Candidate等から内部生成し、Queueを経由させない。
- Tool Resultは同一Agent Loop内でRuntimeが受け取り、Queueを経由せず次の推論へ渡す。
- Time EventとLong-term Review Triggerはbotプロセス内Schedulerが生成し、Runtimeへ直接渡す。

### Memory Retrieval
Status: resolved

Known:
- Ollama Embeddingとpgvectorを使える。
- semantic検索だけでなくAgent、Memory type、subject、時刻等のfilterが必要である。

Decision:
- PostgreSQLのmetadata filter、全文検索、pgvector類似検索を組み合わせるhybrid retrievalとする。
- Retrieval結果はscoreだけで確定せず、件数とContext budgetで制限する。

### Event整合性と障害処理
Status: resolved

Known:
- Agent単位の状態競合と二重処理を防ぐ必要がある。
- LLM、Ollama、Web、Discordは失敗し得る。

Decision:
- File Queueはat-least-once deliveryとし、Message IDの処理記録で冪等化する。
- 1つのbotプロセスはAgent入力をconcurrency 1で処理する。
- PostgreSQL advisory lockにより同じAgent IDの複数プロセス起動を防ぐ。
- Agent Stateにversionを持たせ、状態更新をtransactionとoptimistic lockで適用する。
- 一時障害は上限付きbackoff、恒久障害はdead-letterへ移す。

### 自律Actionの配送
Status: resolved

Known:
- TerminalとDiscordの両方が同じAgentへ接続する。
- UI非依存のAction配送境界が必要である。

Decision:
- 外部からAgentへの入力と、Agentから外部への出力を同じ宛先付きQueue Portで抽象化する。
- Message Envelopeはmessage ID、source、destination、kind、payload、correlation ID、replyTo、createdAtを持つ。
- UI AdapterはAgent宛てMessageをpublishし、自UI宛てMessageをconsumeする。
- Runtimeは入力EnvelopeのreplyToを通常応答の宛先に使用する。
- 自律Actionはbot設定のdefault output destinationへpublishする。
- bot間通信は別Agent宛てMessageとして同じPortを使う。
- UI callbackはRuntimeの標準出力境界として採用しない。

## Decisions

- PostgreSQL + pgvectorを永続ストアとする。
- Deep AgentsをAgent harnessとして採用する。
- Toolはアプリケーション側のRegistryから明示的に注入し、動的追加を許可しない。
- Deep Agentsの組み込み機能をドメイン状態の正本にしない。
- 1つのNode.jsプロセスセットを1つのbot / Agent個体に対応させる。
- 複数botは設定の異なる同一構成のプロセスとして起動する。
- 外部入力のみをEventQueue経由とし、内部EventとTool ResultはRuntime内で処理する。
- 標準Queueはファイルベースとし、HTTP Ingressは将来対応とする。
- Agentへの入力とAgentから外部への出力を宛先付きの双方向Queueで扱う。

## Assumptions

- Node.jsでTypeScriptを実行する。
- LLM推論には `.env.sample` で指定したOllama Cloud、Embeddingには別接続先のローカルOllamaを使用する。
- Web検索とページ取得は `SIMPLE_CLIENT_BASE_URL` で指定した既存サービスを利用し、`docs/web_tool.md` の契約へAdapterで接続する。
- Ollama Cloud modelはTool callingと構造化出力に十分対応するものを運用時に選択する。

## Deferred

- Test Strategyのテストダブルと評価rubric
