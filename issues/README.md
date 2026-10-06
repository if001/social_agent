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
| 035 | [Memory設計とdocs整合](035-align-memory-design-and-docs.md) | なし |
| 036 | [Memory Embedding lifecycle](036-memory-embedding-lifecycle.md) | 035 |
| 037 | [Relevant Memory Queryとranking](037-relevant-memory-query-and-ranking.md) | 035、036 |
| 038 | [SelfとDynamic Stateの完全化](038-complete-self-and-dynamic-state-model.md) | なし |
| 039 | [Intention Triggerと自律Event](039-intention-triggers-and-autonomous-events.md) | 038 |
| 040 | [Long-term Review scopeの完全化](040-complete-long-term-review-scope.md) | 037、038 |
| 041 | [EventとObservationのprovenance](041-event-observation-provenance.md) | なし |
| 042 | [Runtime Safetyとlimit強制](042-runtime-safety-and-limit-enforcement.md) | 041 |
| 043 | [Web Page Archive設計](043-design-web-page-archive.md) | 035–037, 041, 042 |
| 044 | [Web Page Archive実装](044-implement-web-page-archive.md) | 043 |
| 045 | [EmotionのEvent境界](045-event-scoped-emotion.md) | 038 |
| 046 | [DesireのEvent境界](046-event-scoped-desire.md) | 038 |
| 047 | [定期State Review](047-periodic-state-review.md) | 039 |
| 048 | [Drive Schedule同期](048-synchronize-drive-schedules.md) | 047 |
| 049 | [Idle activity trigger](049-idle-activity-trigger.md) | 039 |
| 050 | [Long-term Event evidence](050-long-term-event-evidence.md) | 040, 041 |
| 051 | [明示的Tool Capability](051-explicit-tool-capabilities.md) | 042 |
| 052 | [Memory provenance](052-runtime-memory-provenance.md) | 041 |
| 053 | [Self Continuity review](053-self-continuity-review.md) | 040 |
| 054 | [Values review](054-values-review.md) | 040 |
| 055 | [長期リスト状態の保持](055-preserve-long-term-list-state.md) | 040 |
| 056 | [Social Context subject type](056-social-context-subject-type.md) | 038 |
| 057 | [Drive provenanceとsince](057-drive-provenance-and-since.md) | 038 |
| 058 | [Memory時刻の分離](058-memory-time-separation.md) | 035 |
| 059 | [自律Memory recall](059-autonomous-memory-recall.md) | 047 |
| 060 | [Runtime Event入力](060-runtime-event-inputs.md) | 041 |
| 061 | [中立な初期状態](061-neutral-initial-state.md) | 038 |
| 062 | [Expectation Context方針](062-expectation-context-policy.md) | 018, 020 |
| 063 | [Action Result連携](063-action-result-linkage.md) | 041, 060 |
| 064 | [bot別の表現Persona](064-bot-persona-configuration.md) | 020, 030, 038 |
| 065 | [Runtime標準出力log](065-runtime-stdout-observability.md) | 032, 041, 042 |
| 066 | [安全な詳細エラーログ](066-detailed-safe-error-logging.md) | 065 |
| 069 | [応答・即時状態と応答後Post-processの境界を設計](069-design-response-and-postprocess-boundary.md) | 044、045、046、067 |
| 070 | [応答・Post-process分離に合わせたdocs整合](070-align-docs-for-response-postprocess-flow.md) | 069 |
| 071 | [応答・即時状態とPost-processの分離実装](071-implement-response-postprocess-flow.md) | 069、070 |
| 080 | [既存DBを参照する読み取り専用Agent Debug UI](080-add-read-only-agent-debug-ui.md) | 069、073、078 |

004と005、007と008、010と011は、それぞれの前提Issue完了後に並行実装できる。同じDomain SchemaまたはRuntime orchestrationを変更するIssueは直列化する。
