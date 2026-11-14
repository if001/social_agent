---
created_at: 2026-11-14
status: done
type: change
plan:
  - PredictionのAgent・Event・Runを直接検索用の監査断面として保持し、writerで一致を保証する
  - G3 Taskのclaim・期限・試行・source整合性を実装する
  - Memory Mutationを変更前後と根拠を説明できる完全な監査recordへ拡張する
  - G3・schedule・outbox・Web・Memory auditのowner/provenance列を独立claim・作成順・監査要件で分類する
  - runtime correlation/rate windowに明示的な保持期限cleanupを追加する
  - 実DBintegration testでowner解決、claim/delivery、cleanupを検証する
requirements: [FR-51, FR-52, FR-57, NFR-7, NFR-8, NFR-10, NFR-15, NFR-17]
requires: agent
---

# 043 監査・作業itemの導出可能所有者列と外部キーを整理する

元計画：#038のtable inventory。

## Dependencies

- #039
- #040

## Scope

- Prediction、G3、schedule、outbox、web archive、runtime state、Memory auditを対象に、Eventから導出可能な所有者列、欠けたFK、必要なindexを整理する。
- 子単独のclaim / ownership filter / retentionに必要なdenormalizationだけを残す。
- TTL対象のruntime stateと監査保持のcleanup方針を実装可能な形へ落とす。

## Detailed design

| 対象 | owner / parent方針 | 判断理由 |
|---|---|---|
| `prediction_records` | Agent / Event / Runを保持し、source Runとの一致をwriterで検証する | 直接検索、監査、Debug UIを単純にする限定的な非正規化 |
| `prediction_evaluations` | `prediction_id`と`agent_id`を保持し、Event / RunはPredictionから取得する | Agent filterは直接行い、その他の重複は増やさない |
| `g3_tasks` | Agent、source Prediction / Event / Run、期限、lease、試行、結果を保持する | 独立claimとretryを行うWork item |
| `scheduled_tasks` / `autonomous_schedules` | `agent_id`を保持する | due claim、idempotency、Agent別scheduler filterに必要 |
| `outbox_messages` | `agent_id`を保持する | 配送workerの所有者filterに必要 |
| `web_snapshots` | `agent_id`をfetch provenanceとして保持する。run/tool参照は論理provenanceのまま保持する | Web ToolはAgent Run commit前にarchiveするため、現行順序では物理FKを張れない |
| `memory_mutations` | source、対象・候補Memory、before / after、reason、根拠、適用結果を保持する | create失敗/no-opを含めMemory変更を完全に監査する |
| runtime tables | `agent_id`を保持し、correlationとrate windowを期限でcleanupする。lock keyはAgent存続中再利用する | loop/rate limit/lockはAgent単位のruntime state |

`scheduled_tasks.source_run_id`もTool実行中、Agent Run commit前に作られる。このためWeb provenanceと同様に、このIssueでは存在しない親へ即時FKを要求しない。既存recordへ新しい制約を追加する場合は、#045のdata migrationで参照整合性を検証してからcontract migrationを行う。

runtime cleanupは監査recordを削除せず、指定時刻より古い`runtime_correlations.created_at`と、指定windowより古い`runtime_rate_windows.window_start`だけを同一transactionで削除する。

### G3 Task lifecycle

- 状態は`pending -> running -> result-pending -> completed`とする。model失敗または結果配送失敗は、期限・最大試行回数内なら`pending`へ戻す。
- Agent単位に、`pending`とlease切れの`running` / `result-pending`を`FOR UPDATE SKIP LOCKED`で1件ずつ再claimし、claim時にattemptを増やす。
- claim時のlease値をtokenとして結果保存・完了・retryで照合し、lease切れ後の旧workerによる更新を拒否する。claimと処理timeoutにも最大試行回数・期限を適用する。
- model出力は`result-pending`で保存し、`prediction-g3-result` EventがRuntimeでcommitされた後だけ`completed`にする。配送再試行では保存済みmodel出力を再利用する。
- G3 repositoryはEventsへ直接INSERTしない。Eventの永続化はRuntime経路だけが行う。

### Memory Mutation attempts

- 1行は論理操作ではなく1回の実行attemptを表す。`attempt`を持ち、`failed`も別transactionで残す。
- `applied` / `no-op`の成功attemptだけを冪等完了とみなす。`failed`は同じ論理操作の再試行を妨げない。
- `source_event_id`には実在するEventだけを設定する。Reflectionは`source_kind` / `source_id`で追跡する。
- 失敗時点でoperationを解決できないattemptはoperation=`unknown`、status=`failed`として区別する。失敗attemptの採番は別transaction内のadvisory lockで直列化する。
- reconciliationはMemory更新前に成功attemptを検索し、成功済みなら再適用しない。

## Out of scope

- Event / Reflection core tableの変更。
- 実データの監査record削除。

## Acceptance criteria

- [x] NFR-7：意味的正本を一か所に置き、Predictionなど意図的な非正規化はwriterで親との一致を検証する。
- [x] NFR-8：G3をlease付きでclaim/reclaimし、結果EventのRuntime commit後だけ完了させる。
- [x] NFR-10：runtime correlation / rate windowだけを設定可能な期限でcleanupする。
- [x] NFR-15 / NFR-17：Memory Mutationをattempt単位で監査し、成功済みだけを冪等完了として扱う。

## Tests

- Prediction owner不一致、G3のAgent別claim・lease切れreclaim・stale token拒否・attempt上限・保存済み出力再利用、repositoryによるEvent二重作成の不在を実DBで検証する。
- Memory reconciliation再試行と、failed attempt後の成功再試行を実DBで検証する。
- runtime cleanupが監査recordを削除しないことを実DBで検証する。
