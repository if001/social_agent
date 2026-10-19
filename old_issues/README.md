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
| 081 | [Interest進捗と自律探索の形成・減衰をdocsへ反映](081-align-docs-for-interest-progress-autonomy.md) | 076、077 |
| 082 | [Interest進捗に基づく自律探索と減衰を実装](082-implement-interest-progress-autonomy.md) | 081 |
| 083 | [初期の具体的嗜好と適応的な対話・探索方策をdocsへ反映](083-align-docs-for-initial-tastes-and-adaptive-interaction.md) | 081、082 |
| 084 | [botごとの具体的な初期嗜好とユーザー理解の関心を設定](084-configure-concrete-initial-tastes-and-relational-interests.md) | 083 |
| 085 | [行動結果から質問・探索方法を適応](085-adapt-interaction-methods-from-action-results.md) | 083、084 |
| 134 | [人格上の拒否を外部Actionとして配送](134-deliver-personality-refusal.md) | なし |
| 135 | [関連状態を選択しModel入力全体を6,000 token以下に制限](135-select-focused-context-and-gate-total-input.md) | なし |
| 136 | [Run limitを一本化し修復入力を有界化](136-unify-run-limits-and-bounded-repair.md) | 135 |
| 137 | [Deep Agents middlewareを明示的な最大2段loopへ置換](137-replace-deep-agent-with-explicit-two-stage-loop.md) | 135、136 |
| 138 | [Action配送をPost-processの完了・失敗から分離](138-decouple-action-delivery-from-post-process.md) | 134 |
| 139 | [ContinuityとMemory抽出を統合しCandidate判定をReviewへ移動](139-consolidate-continuity-memory-and-defer-candidates.md) | 138 |
| 140 | [現在のEmotionを短期状態として保持しAction判断へ反映](140-persist-current-emotion-and-use-it-in-decisions.md) | 135、137 |
| 141 | [Motiveの再検討時刻から自律Eventを前倒し](141-schedule-autonomy-from-due-motives.md) | 139、140 |
| 142 | [初期Personaから固定的な行動ラベルを除去](142-remove-behavior-labels-from-initial-persona.md) | 137 |
| 143 | [状態差による行動差を反復評価](143-evaluate-state-dependent-behavior.md) | 134、137、140〜142 |
| 144 | [状態見直しとMemory想起を自律評価triggerへ統合](144-consolidate-autonomy-triggers.md) | 139、141 |
| 145 | [最小Agent loopの実装後に現行docsを一次資料へ整合](145-align-current-docs-after-minimal-loop.md) | 134〜144 |

004と005、007と008、010と011は、それぞれの前提Issue完了後に並行実装できる。同じDomain SchemaまたはRuntime orchestrationを変更するIssueは直列化する。

## 2026-10-11 敵対再レビューへの対応

[元レビュー](../note/adversarial-rereview-2026-10-11.md)を実装・検証単位へ分割した後続Issue。146〜158は完了した。Issue 143のdoneは当時の記録であり、単独では受け入れ基準の達成を意味しない。対照scenario・実executor・反復実測は146〜148へ追跡できる。148のlive gateは不合格であり、自律性改善は未実証である。

| ID | Issue | Status | 優先度 | Dependencies |
|---|---|---|---|---|
| 146 | [状態差を比較する6組のpaired scenarioを定義する](146-define-state-dependent-paired-scenarios.md) | done | P0 | なし |
| 147 | [Live評価でTool選択・配送・次stateを実行して記録する](147-execute-live-evaluation-through-runtime.md) | done | P0 | 146 |
| 148 | [対照試験を各variant 3回実行し自律性の合否を記録する](148-run-paired-live-evaluation-and-gate.md) | done（gate fail） | P0 | 146、147、149、150、151、152 |
| 149 | [全model call直前に入力予算を検査する](149-gate-every-model-call-input.md) | done | P0 | なし |
| 150 | [実model call数でmaxStepsとbudgetを強制する](150-account-actual-model-calls.md) | done | P0 | なし |
| 151 | [motive-review対象MotiveをContextへ必ず選択する](151-retain-target-motive-in-context.md) | done | P0 | なし |
| 152 | [失敗Toolだけではno-external-actionを許可しない](152-reject-no-action-after-failed-tools.md) | done | P0 | なし |
| 153 | [現EventのMeaningとEmotionをAction判断へ明示的に渡す](153-pass-current-emotion-into-decision.md) | done | P1 | 149、150、148 |
| 154 | [activeMotiveの根拠にSelf・Mood・関係性・Motiveを表現する](154-represent-state-evidence-for-active-motive.md) | done | P1 | なし |
| 155 | [後処理Promiseの失敗cacheを破棄してretryを回復する](155-evict-rejected-postprocess-promises.md) | done | P1 | なし |
| 156 | [ContinuityとMemoryを永続的な単一jobへ統合する](156-persist-single-experience-integration-job.md) | done | P1 | 155 |
| 157 | [依存取得と失敗回復のために最大25回のTool実行を許可する](157-allow-bounded-second-tool-call.md) | done | P1 | 149、150、152 |
| 158 | [現行docsと完了判定を再レビュー後の実装・実測へ揃える](158-align-docs-and-completion-with-rereview-evidence.md) | done | P1 | 146、147、148、149、150、151、152、153、154、155、156、157 |

実装は各Issueブランチで行いmainへ統合した。今後、行動を変える変更を加えた場合は148と同条件で再評価し、gateが通るまで自律性改善を実証済みとしない。
