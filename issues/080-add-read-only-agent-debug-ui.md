---
created_at: 2026-10-06
status: created
---

# 080: 既存DBを参照する読み取り専用Agent Debug UIを追加する

## Background

Botの動作確認時に、AgentのSelf、持続状態、直近Interactionの即時状態、参照Memory、状態変更、Tool実行、応答後処理、自律Scheduleを複数のSQLや標準出力から個別に確認する必要がある。既存DBにはこれらの正本と監査記録の大部分が保存されているため、新しいtrace基盤や外部observability libraryを導入せず、現在保存されている情報を横断して確認できる簡易UIを用意する。

## Scope

- `spec/`を一次情報として、Self、即時状態、持続状態、Memory、Intention、自律処理の意味を確認する
- `docs/`へDebug UIの目的、起動方法、表示内容、読み取り専用境界を追加する
- Bot Runtimeとは別プロセスで起動するローカルHTTP UIを実装する
- `POSTGRES_URL`を実行時環境から受け取り、既存DBだけを読み取る
- Agent一覧とAgent選択を提供する
- Overviewへ以下を表示する
  - Identity、Family
  - Shared / Initial / Acquired Disposition
  - Values、Interests、Preferences、Roles、Raison d'être
  - Self Narrative、Self Continuity
  - Mood、Drive、Current Interest、state version、最終更新時刻
  - Working Social Context
  - active Intention
  - Autonomous Scheduleと次回実行時刻
- Run一覧と詳細へ以下を表示する
  - Event、Run、開始・終了時刻、処理時間、成功・失敗
  - Subjective Meaning、最終Action、応答内容
  - そのInteractionで提案されたEmotionとDesire
  - Memory retrieval trace
  - State changeのbefore / after、理由、根拠ID
  - Tool executionの名前、成否、所要時間
  - Post-process jobの状態、attempt、failure reason
  - 保存済みPost-process出力
- Memory一覧へkind、内容、重要度、retrieval priority、Embedding状態、発生時刻、根拠Eventを表示する
- Long-term Candidate一覧を表示する
- 画面を一定間隔で更新し、最新状態を確認できるようにする
- DB値とJSON値を安全にHTML escapeし、UIからSQLや状態変更を実行できないようにする
- `127.0.0.1`だけをdefault bind先とする
- 表示件数を制限し、RunやMemoryの全件読み込みを避ける

## Out of scope

- 新しいruntime trace、Model Call trace、prompt全文のDB保存
- LLM内部の詳細な思考過程の表示
- 外部observability libraryやSaaSとの連携
- 状態、Memory、Intention、ScheduleをUIから変更する機能
- Botへのメッセージ送信
- 認証付き公開Web UI
- Web Snapshot本文やEmbedding vectorの全文表示
- React、Next.js等のFrontend framework導入

## Implementation notes

- Node.js標準HTTP server、静的HTML、CSS、最小限のbrowser JavaScriptを優先する。
- `pnpm debug:ui --env-file .env.ao`のように、Botと同じ実行時環境ファイル指定方式を利用できるようにする。
- `.env`、`.env.ao`、`.env.aka`の内容は実装・検証時に直接参照しない。設定追加が必要な場合は`.env.sample`だけを変更する。
- EmotionとDesireは永続的な現在状態ではないため、最新Runの`AgentCoreOutput`および`state_changes`から「その応答時の即時状態」として表示する。
- Mood、Drive、Current Interestは`agent_states`の現在値を表示し、変更理由は`state_changes`へリンクする。
- `agent_runs.result`にはInteraction結果、Memory retrieval trace、完了済みPost-process出力が含まれる。未完了・失敗中の後処理状態は`post_process_jobs`を参照する。
- Tool入力・結果、Memory、Event本文は個人情報を含み得るため、localhost用途であることを明示し、一覧では概要、詳細は明示的な展開操作で表示する。
- DB user自体のread-only化は運用側の選択肢とし、アプリケーションコードではSELECT以外を発行しない。

## Acceptance criteria

- Agentを選択し、Selfと現在の持続状態を一画面で確認できる
- 直近InteractionのEmotion、Desire、Subjective Meaning、Action、応答を確認できる
- RunからEvent、取得Memory、状態差分、Tool execution、Post-processへ追跡できる
- Memory、Intention、Candidate、自律Scheduleの現在値を確認できる
- 即時状態と持続状態が表示上明確に区別される
- Post-processのpending、processing、completed、failedとfailure reasonを確認できる
- UIがINSERT、UPDATE、DELETEを発行しない
- defaultではlocalhost以外から接続できない
- env fileを直接読み取らず、実行時に渡された環境変数で起動できる
- Bot Runtimeを停止せずにUIを起動・停止できる

## Tests

- Repository testでAgentごとのデータ分離、件数上限、Run関連データの組み立てを確認する
- HTTP testでOverview、Run detail、Memory endpointと404を確認する
- HTML escape testでEvent、Memory、Tool payloadを安全に表示できることを確認する
- UI経由でDB更新queryが発行されないことをRepository公開契約で確認する
- `pnpm typecheck`
- `pnpm lint`
- 関連unit / integration test
- BrowserまたはHTTP clientでのmanual smoke

## References

- [Concept Design: Internal State and Autonomy](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation Design: Memory](../spec/personal-agent-implementation-design-v2.md#16-memory)
- [Architecture](../docs/ARCHITECTURE.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
- [Issue 069: Response and Post-process boundary](./069-design-response-and-postprocess-boundary.md)
- [Issue 078: Self to autonomy E2E verification](./078-verify-self-drive-autonomy-flow.md)
