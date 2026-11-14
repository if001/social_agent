---
created_at: 2026-11-14
status: done
type: change
plan: []
requirements: [FR-37, FR-78, NFR-7, NFR-8]
requires: agent
---

# 041 Event・Run・Experience・Projectionを正規化する

元計画：#038のEvent / Run / Experience参照モデル。

## Dependencies

- #039
- #040

## Scope

- `events`を不変の論理Event、`agent_runs`をretryを含む処理attemptの入出力履歴として維持する。Experienceは成功した論理Eventごとに一度だけ形成する。
- Event Experienceを意味表現の正、Event Projectionを検索indexへ分離するschemaを追加する。
- Event subject relation、Projection縮小、Experience Integration input重複の削減を移行する。
- Tool / Prediction / Schedule / Web provenanceの重複したEvent / Agent所有者列をRun参照へ正規化し、tool-result Eventの新規writerを廃止する。
- G3を含め、検索対象とするEvent ProjectionはEvent Experience形成後にだけ作る。G3 repositoryによるProjection直接作成を廃止する。
- 新しいEvent traceへDebug UIを切替える。旧recordの完全表示をbackfill・互換対象にしない。

## Out of scope

- Reflection子tableの正規化。
- Memory reconciliationアルゴリズム変更。

## 詳細設計

- `events`はagent、kind、occurredAt、Observationを持つ不変の論理Event正本とする。
- `agent_runs`はEvent attemptごとの入力・出力監査とし、retryは同じEventへ別Runとして記録する。
- `tool_executions`は`run_id`からEventへ到達し、重複する`event_id`と廃止するtool-result Eventへの`result_event_id`を持たない。完全なTool入出力は同tableに保持する。
- `event_experiences`はEvent固有のsummaryとfactsの正本とし、agent、occurredAt、subjectsを複写しない。Experience Integrationとの由来は`integration_id`で保持する。
- `event_subjects`をEventとsubjectの中間tableとし、Experience確定時にactorと解決済みsubjectを一度だけ関連付ける。
- `event_projections`は`event_id`、Experience content hash、embedding、embedding model / dimension / status / error / last attemptだけを持つ再生成可能な派生indexとする。検索本文、agent、kind、occurredAt、subjectは`events`、`event_experiences`、`event_subjects`からjoinする。
- `experience_integrations`は`source_run_id`を親とし、agentとsource EventはRunから導出する。Run / Event / Tool / commit artifactから再構成できる入力snapshotは保持しない。モデル出力、適用結果、failure、statusは監査として保持する。
- Scheduled TaskとWeb provenanceはsource Runを正とし、source Event / agentはRunから導出する。実行後に独立して必要なTask所有者とWeb取得主体は保持する。PredictionはEventを直接親とするrecordのためagent所有者列をEventから導出する。
- G3を含むProjectionはExperience Integration成功transactionだけで作成する。G3 repositoryとTool writerはProjectionやtool-result Eventを直接作成しない。
- #041はexpand、既存Experienceからのsubject relation・縮小Projection再構成、新reader / writer切替までを行う。重複列は新writerが書かないnullable互換列とし、#045の実DB整合性・保持期間確認を経た後の最終drop Issueまで物理削除しない。過去Debug UI互換のためのsnapshot backfillは行わない。

## Acceptance criteria

- [x] FR-37：Tool監査とEvent traceを失わずにEventとToolを追跡できる。
- [x] FR-78：ReflectionがEvent Experienceを検索・固定範囲入力として利用できる。
- [x] NFR-7 / NFR-8：Event Experience、Projection、Commit artifactが原記録を複写せずatomicに更新される。

## Tests

- FR-37：Event → Tool → Experience / Projectionの参照整合性を実PostgreSQLで検証する。
- FR-78：vector / keyword / subject / recency検索とbackfill後のReflection入力を検証する。

## 解消済みの停止理由

- `docs/ARCHITECTURE.md`内でEvent Projectionの責務が一致していない。§Reflectionはagent所有権、Event ID、時刻、種別、subject、検索本文、embeddingをProjectionが持つとする一方、§永続化と運用保証はExperience summary hashに対応するembedding、model、状態だけを持つ従属indexとしている。
- ScopeにあるProjection縮小、Event subject relation、Experience Integration input重複、Tool / Prediction / Schedule / Web provenanceの削除対象列と参照先が列単位で未確定である。
- 2026-11-14にユーザーが、正規化joinを優先する上記詳細設計とArchitecture修正を承認したため再開した。

## 実装メモ

- Drizzle schemaはexpand段階として`event_subjects`と縮小Projection metadataを追加し、旧重複列をnullable互換列へ移した。新reader / writerはEvent・Run・Experience・Subject relationをjoinし、旧列を正本として読書きしない。物理dropは#045の実DB検証後に作る最終drop Issueで行う。
- Tool Resultは`tool_executions`へ完全保存し、RunからEventへ到達する。新規tool-result Event writerとG3 repositoryのProjection直接writerを廃止した。
- `agent_runs.input_snapshot`を完全なAgent Core入力の正本とし、Experience Integrationはsource Runからagent、Event、入力、結果を再構成する。
- data migrationはdry-run既定、`--apply`時だけsubject relationと欠落Projectionをbackfillする。参照不整合又はactive Integrationがあれば停止し、content hash変更時は旧embeddingを破棄して再embedding対象へ戻す。
- Prediction等の派生所有者列全般とFK整理は依存関係上#043、実DB切替・保持期間・rollback境界は#045の責務とする。
- 実DBtest：`FR-25, NFR-7: materializes normal Core proposals, Concern Activity, and Tool execution records with Runtime-owned metadata`、`NFR-7: restores pending Integration traces from the canonical Run snapshot`、`FR-82, FR-78: persists an Event Experience without a long-term Memory and exposes it to Reflection`、`NFR-8: rolls back Event Experience and Projection together when Projection persistence fails`、`FR-78, NFR-7: backfills searchable subjects and content hashes from legacy Event Experience rows`。
- 検証：`pnpm typecheck`、`pnpm build`、`pnpm test`（237件）、`pnpm test:integration`（57件）、`pnpm test:system`（54件）、Issue対象ファイルのESLint、`git diff --check`。全体`pnpm lint`と`pnpm test:evaluation`にはIssue #041外の既存失敗が残る。
- 仕様分析：`docs/work/analyze/2026-11-14-change-issue-041.md`（CRITICAL/HIGH/MEDIUM/LOW 0）。独立レビュー：`docs/work/reviews/2026-11-14-issue-041.md`（CRITICAL/HIGH/MEDIUM 0）。
