---
created_at: 2026-10-05
status: created
---

# 067: Deep Agentを起動時に構築しrun contextで再利用する

## Background

現在のOllama Deep Agents adapterは、EventごとにTool wrapperと`createDeepAgent()`を作り直している。これはTool wrapperが`agentId`、`runId`、`eventId`、実行上限、transport、実行記録の収集先をclosureで保持しているためであり、Deep Agent自体の制約ではない。

BotがCapabilityとして利用可能なToolの定義、入力Schema、公開範囲はBot起動時に確定し、応答ごとには変えない。実際にToolを使うかどうかは、各EventでSelf、内部状態、Memory、Intention、Social Contextなどを踏まえてAgent Coreが判断する。runごとに変化するIDと実行情報はDeep AgentのcontextおよびMiddlewareへ渡す。Deep Agent内の標準Tool loopを維持しながら、AgentをBot process内で再利用し、providerのstructured outputを利用する。

## Scope

- `createDeepAgent()`、Model、Tool定義をBot起動時のcompositionで一度だけ構築する
- Botごとに公開するTool一覧を起動時に確定し、各runで同じToolインスタンスを再利用する
- `agentId`、`runId`、`eventId`、AbortSignal、Tool call上限、transportなどをrun contextで渡す
- Tool実行の許可確認、回数制限、trace収集をcontext対応のToolまたはMiddlewareへ移す
- Agent Core出力SchemaをDeep Agentの`responseFormat`へ設定し、自由形式JSONの後段parse依存を除去する
- docsで定義した`beforeAgent`、`wrapToolCall`、`afterAgent`の責務に従ってMiddlewareを実装する
- Agent生成回数と各Model attemptの時間を観測できる既存logを維持する

## Out of scope

- Episodic Memory、Intention、Long-term Candidateを応答後の別Eventへ分離する変更
- Discordへの途中応答streaming
- Toolの追加・削除をBot稼働中に反映するhot reload
- Long-term Review Coreの変更

## Implementation notes

- Toolの名称、説明、入力Schema、実装へのbindingはBot起動時に固定する。
- Toolカタログの固定を、Tool利用条件やActionの固定対応表として扱わない。Agent自身のDriveやDesireからの自律的なTool選択を維持する。
- run固有情報をmodule globalや共有可変closureへ置かず、Deep Agentの`contextSchema`とLangChain Middlewareのruntime contextから取得する。
- 同時runが発生してもID、上限、transport、Tool traceが混線しない構造にする。
- 共有Agentインスタンスが並行呼び出しに対して安全であることと、同一個体のEventを無秩序に並列処理することは区別する。同一個体の状態確定はEvent順序と既存のRuntime／DB境界を守る。
- Agentの再利用によって前runのmessagesやDomain stateを暗黙に継承しない。各Eventの入力はContext BuilderがPostgreSQLを正本として組み立てる。
- `responseFormat`で返る`structuredResponse`をDomain schemaで再検証し、参照整合性などprovider schemaで表現できない検証はHarnessに残す。
- Tool loopはDeep Agent内部に維持し、RuntimeがTool actionを再実行しない。
- docsは`spec/`を一次情報として、起動時構成とrun時contextの境界を明示する。

## Acceptance criteria

- 1つのBot processで`createDeepAgent()`が起動時に一度だけ呼ばれ、複数Eventで同じAgentが利用される
- Tool定義が起動時に固定され、runごとのIDと制約だけがcontextから解決される
- 共有Agentへ並行する2 runを与えてもTool実行記録が混線せず、それぞれ正しいagent / run / eventへ関連づく
- 本番の同一個体に対する状態確定はEvent順序を保持し、共有Agent化によって状態の因果関係を壊さない
- Agentを再利用しても、Context Builderが渡していない前runのmessagesやDomain stateを次のrunへ混入させない
- Deep AgentのTool callからTool Result、最終応答まで同じrun内で完結する
- 正常出力は`responseFormat`から取得され、Markdown fenceを含む自由形式JSON parseを必要としない
- 不正なDomain参照は永続化前に拒否され、Tool副作用を再実行しない
- `docs/ARCHITECTURE.md`と`docs/IMPLEMENTATION_PLAN.md`が実装後のライフサイクルと一致する

## Tests

- Agent factoryを注入したcontract testで、複数`invoke()`に対する生成回数が1回であることを確認する
- 2つのrun contextを使ったTool testで、ID、上限、transport、traceが混線しないことを確認する
- 連続する2 runで、2回目の入力に含まれない1回目のmessagesやDomain stateが暗黙継承されないことを確認する
- structured outputの正常、不正Schema、Domain参照不正をcontract testで確認する
- 既存のTool loop system testで、Tool ResultがDeep Agentへ戻り最終ActionだけがRuntimeへ返ることを確認する
- typecheck、lint、unit、contract、system testを実行する
- `.env`を実行時に読み込むintegration testは必要時のみ実行し、ファイル内容は参照しない

## Dependencies

- Issue 068（再利用可能なDeep Agent構成に向けたdocs整合。本Issueより先に完了する）
- Issue 021（Deep Agent内部Tool実行への統一、完了済み）
- Issue 022（Runtimeでの提案・実行記録保存、完了済み）
- Issue 065（Bot runtime標準出力log、完了済み）

## Plan reference

- [Concept design: 基本的なAgent Loop](../spec/personal-agent-concept-design-restructured-v2.md#21-基本的なagent-loop)
- [Concept design: Toolと通常のAgent能力](../spec/personal-agent-concept-design-restructured-v2.md#22-toolと通常のagent能力)
- [Concept design: シンプルさを優先する](../spec/personal-agent-concept-design-restructured-v2.md#24-シンプルさを優先する)
- [Implementation design: Agent Core / Tool Loop](../spec/personal-agent-implementation-design-v2.md#26-tool-loop)
- [Implementation plan: IP-07 Agent Harness](../docs/IMPLEMENTATION_PLAN.md#ip-07-agent-harnessdeep-agents-adapter)
- [Implementation plan: IP-10 Tool Loop](../docs/IMPLEMENTATION_PLAN.md#ip-10-tool-registryweb-toolfile-tooltool-loop)
