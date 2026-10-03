# Issues

`docs/IMPLEMENTATION_PLAN.md` を実行可能なIssueへ分割した一覧である。各Issueでは、合意済みの公開境界に対して失敗するテストを先に追加し、最小実装、test pass、作業単位のrefactorの順で進める。

| ID | Issue | Dependencies |
|---|---|---|
| 001 | [Project foundationとtest harness](001-project-foundation.md) | なし |
| 002 | [Domain modelとPort契約](002-domain-contracts.md) | 001 |
| 003 | [Configurationとprocess lifecycle](003-configuration-lifecycle.md) | 001, 002 |
| 004 | [PostgreSQLとRepository基盤](004-persistence-foundation.md) | 002, 003 |
| 005 | [Addressed File Queue](005-addressed-file-queue.md) | 002, 003 |
| 006 | [State UpdateとEvent transaction](006-state-update-transaction.md) | 002, 004 |
| 007 | [Agent HarnessとOllama Cloud](007-agent-harness-ollama-cloud.md) | 002, 003 |
| 008 | [Embedding、Retrieval、Context Builder](008-memory-retrieval-context.md) | 002, 004 |
| 009 | [Agent RuntimeとTerminal UI](009-runtime-terminal.md) | 002–008 |
| 010 | [Tool Registry、Web／File Tool、Tool Loop](010-tools-and-tool-loop.md) | 005, 007, 009 |
| 011 | [Schedulerと自律行動](011-scheduler-autonomy.md) | 006, 009 |
| 012 | [Long-term Reviewとcompaction](012-long-term-review.md) | 006, 008, 009, 011 |
| 013 | [Multi-bot通信と復旧](013-multi-bot-recovery.md) | 005, 009, 010 |
| 014 | [Discord Adapter](014-discord-adapter.md) | 005, 009 |
| 015 | [決定的System suiteと運用CLI](015-system-suite-operations.md) | 010–014 |
| 016 | [Live Ollama Scenario Evaluation](016-live-llm-evaluation.md) | 015 |
| 017 | [Evaluation Store、Soak、完成判定](017-soak-release-gate.md) | 016、026、Manual Smoke |
| 018 | [specとdocsの整合](018-align-design-documents.md) | なし |
| 019 | [docsと実装の差分調査](019-audit-implementation.md) | 018 |
| 020 | [通常Coreの提案契約](020-agent-proposal-contracts.md) | 019 |
| 021 | [Deep Agent内部Tool実行](021-deep-agent-tools.md) | 020 |
| 022 | [Runtimeで提案とTool記録を確定](022-runtime-state-and-traces.md) | 021 |
| 023 | [Long-term Reviewの独立フロー](023-long-term-review-flow.md) | 022 |
| 024 | [Event振り分け](024-event-routing.md) | 023 |
| 025 | [回帰検証とLive評価](025-evaluation-and-regression.md) | 024 |
| 026 | [残り6 Scenarioの単発Live確認](026-remaining-live-scenarios.md) | 016、025 |
| 027 | [必要時の反復Live評価](027-statistical-live-evaluation.md) | 026 |
| 028 | [2 bot起動docs整合](028-align-two-bot-startup-docs.md) | なし |
| 029 | [2 bot起動の実装差分調査](029-audit-two-bot-startup-implementation.md) | 028 |
| 030 | [複数bot起動設定とCLI](030-multi-bot-runtime-configuration.md) | 029 |
| 031 | [本番Contextとcomposition](031-production-agent-context-and-composition.md) | 030 |
| 032 | [Bot Host lifecycle](032-bot-host-lifecycle.md) | 031 |
| 033 | [2 Discord bot Manual Smoke](033-two-discord-bot-smoke.md) | 032、034 |
| 034 | [Discord mention routing](034-discord-mention-routing.md) | 032、033の前提 |

004と005、007と008、010と011は、それぞれの前提Issue完了後に並行実装できる。同じDomain SchemaまたはRuntime orchestrationを変更するIssueは直列化する。
