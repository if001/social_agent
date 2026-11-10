# Reflection / Concern Activity 設計監査（2026-11-10）

対象: Issue 021。実装・一次文書の変更前に、Reflection Session、対象別Reflector、Concernの減衰・クローズに必要な根拠を現行コードとshiroの既存DBから読み取り専用で確認した。

## 実測範囲

DB照会は `SET default_transaction_read_only = on` を設定して実施した。本文やユーザー発話は出力せず、ID、件数、時刻、JSON構造だけを確認した。

| 記録 | shiroの実測 | 判定 |
|---|---:|---|
| 現在Concern | 66件（active 53、satisfied 13）、全件にID、`reconsiderAt` 4件 | 現在値の取得は可能。ただしConcernごとの作成・更新時刻はない。 |
| `state_changes` のConcern全体更新 | 223件。差分から229件の追加、13件の変更を観測 | 配列のbefore/afterはあるが、Concern単位の操作・時刻・原因として正規保存されていない。 |
| Agent CoreのConcern proposal | create 211、derive 36 | Run / Eventとの対応はある。ただしproposal採用・Runtime採番Concern IDへの確実な対応表はない。 |
| `concern_propose` Tool実行 | create 226、derive 42 | Tool入力・結果はあるが、最終State内のIDとの対応はない。 |
| Reflection | 184 run、出力のcreate 77、upsert 25、remove 5 | input / output / planは残る。しかしcreate 77件はいずれもRuntime採番前のため、出力から生成Concern IDを復元できない。Reflection commit自体は`state_changes`を残さない。 |
| Memory | 509件すべてに既存Eventを指す根拠ID。`memory_mutations` 374件（create 373、update 1） | Event根拠・作成/update/no-opの監査に概ね利用できる。Memory間根拠は現状0件。 |
| Event | tool-result以外667件のうちactorあり94件、causation / correlationあり各94件 | 直接ユーザー/外部Eventの話者・因果は利用可能。内部Eventの多くには主体がなく、Relationship根拠として一律には十分でない。 |
| Relationship | 現在値とState配列の過去snapshotのみ | subjectごとの作成・更新・根拠・最終活動を直接検索できない。 |
| Reflection plan | 184 run中、completed plan 64、memory失敗でblocked 3、planなし117 | 一括Reflectionのrun状態は確認できるが、対象別Reflectorのattempt / input / output / retryを表せない。 |

## 保存経路の確認

### Concern

`ConcernSchema`の正規項目は `id`、`description`、`whyItMatters`、`status`、任意の`reconsiderAt`だけである。`agent_states.concerns` は現在値のJSON配列で、`agent_states.updated_at`はState全体の時刻である。

通常Eventでは、`AgentStatePatchService` がproposalを完全Stateへ適用し、`PostgresEventTransaction` がConcern配列全体のbefore/afterを`state_changes`へ保存する。`tool_executions`には`concern_propose`の入力がある。しかし、採択されたproposalとRuntimeが付与したConcern IDを結ぶ外部キー・記録はない。

Reflectionでは`reflection_runs.output`にcreate / upsert / removeが残るが、createのIDはRuntimeがcommit時に採番し、採番結果を`reflection_runs.output`や別の対応表へ保存しない。Reflection commitは`state_changes`も書かない。したがって既存記録から、特定Concernの作成・派生元・最終レビュー・最終meaningful activityを完全かつ一意には復元できない。

### Memory

`memories.evidence_event_ids`、`evidence_memory_ids`、`source_agent_id`、versionがあり、`memory_mutations`はsource Event・intent index・candidateを記録する。既存shiroの全509 Memoryは根拠Event IDが存在し、Memory整理の根拠窓として使える。ただしReflectionの現実装は、一つの出力Memoryに入力Event全件を根拠として付与するため、個別Eventとの精密な因果は弱い。

### Relationship / Self / Mood

Event observationにはactor、causationId、correlationIdを保存できるため、直接観測された人・外部主体との関係を根拠にできる。一方で内部Eventの多くにactorがなく、Relationshipの更新履歴はConcern同様にState配列snapshotのみである。Self / Moodも現在StateとReflection出力の一括記録はあるが、対象別のattempt・差分・retryはない。

## 分類

| 必要事項 | 現行記録だけで可能か | 必要な対応 |
|---|---|---|
| Memory ReflectorがEvent根拠つきMemoryを読む | 概ね可能 | 新設Sessionでは、個別根拠の精度を改善する。 |
| Relationship Reflectorが直接観測した主体を読む | 部分的に可能 | actor欠損を「根拠なし」と扱う。Relationship Activityは新規保存が必要。 |
| Concernごとの作成・派生・focus・進展・review・status変更・最終活動 | 不可 | commit層によるConcern Activityの新規正本が必要。 |
| 既存Concernのstale開始時刻 / 最終活動の再構成 | 不可 | 推測で補わないbaseline migration方針が必要。 |
| 現行Reflectionを対象別retry / auditへ分離 | 不可 | Session / Reflector attemptの保存設計が必要。 |

## 結論と承認が必要な点

Issue 021の提案どおり、Concern本体を肥大化させず、commit層が原子的に記録するConcern Activityを正本にする設計は必要である。ただし既存Concernには歴史を正確に遡って付与できないため、Activity導入時のbaselineを方針として明示しなければならない。

候補は次のとおりである。

1. **移行時点をbaselineにする**: 既存active Concernごとに「履歴不明・baseline作成」だけを記録し、stale時計をmigration完了時から開始する。過去を捏造せず、即時クローズを避けられる。
2. **legacy Concernを減衰判定から除外する**: 新規Activityが生じるまで既存Concernを閉じない。安全だが、触れられないactive Concernが残り続ける可能性がある。
3. **既存snapshotから時刻を推定する**: `state_changes`やReflection出力を探索して仮の最終活動を作る。ID対応が不完全であり、本監査の「推測で補わない」条件に反するため推奨しない。

また、一次仕様C-15の「時間のみでConcernを削除しない」は、十分な取得・再検討機会後にRuntimeが決定論的に`abandoned`へ移す設計へ更新する必要がある。これは人の承認なしに変更できない。

この承認が得られるまで、後続Issue 022（Activity / stale close）と023（対象別Reflector）を開始しない。
