---
created_at: 2026-11-14
status: done
type: change
plan: []
requirements: [FR-41, FR-42, FR-78, FR-79, FR-81, NFR-7]
requires: agent
---

# 042 Reflection監査snapshotとTool traceを正規化する

元計画：#038のReflection Session監査モデル。

## Dependencies

- #039
- #040
- #041

## Scope

- Reflection Session共通inputを`reflection_runs`の唯一のsnapshotとし、target / batch inputをselectorへ縮小する。
- Reflection Tool executionをrelationへ正規化し、attempt / batchのTool JSON配列を移行する。
- Reflection子tableから親で導出できる列を削除し、resolver監査を維持する。
- backfill、retry、Debug UI、実DB検証を更新する。

## Detailed design

- `reflection_runs.input`だけをSession snapshotの正本とする。初期snapshotに加え、先行pass後の各target入力と初期窓外のReconciliation anchorを親へ保存する。`reflection_attempts.input`と`reflection_memory_batches.input`は、再開対象を特定するselector（target、batch index、Event ID、anchor Memory ID）のみを保持し、Self、Mood、Memory本文、Event本文を複写しない。
- Tool実行は`reflection_tool_executions`へ1 call 1 rowで保存する。rowはReflection、target、任意のbatch index / anchor Memory ID、call順、tool call ID、tool名、input、result/error、開始/終了時刻を持つ。再試行では同じscopeのtraceを置換し、完了済みscopeは再実行しない。
- `reflection_attempts` / `reflection_memory_batches` / `reflection_resolutions`のAgent所有者は`reflection_runs`から導出する。通常readerは必ず親をjoinしてAgentを絞り込む。
- schema migrationとdata migrationの間に既存JSONの読取り期間が必要なため、#042では旧`agent_id` / `tool_executions`列をnullableな互換列として残すが、新writer/readの正本にはしない。#045で既存recordをrelationへbackfillして差分確認し、保持期間後のdropは別Issueとする。
- Debug UIは親Session snapshot、selector、relation化したTool traceを組み立てて表示する。過去rowはrelation backfill前にはTool traceが空でもよい。

## Out of scope

- Reflectionの対象順序、LLM出力schema、RAG rankingの変更。

## Acceptance criteria

- [x] FR-41 / FR-42：固定Session、部分成功、retry、監査が維持される。
- [x] FR-78 / FR-79 / FR-81：Formation / Reconciliationの根拠、resolver、call予算を追跡できる。
- [x] NFR-7：同じReflection入力が子recordに全複写されない。

## Tests

- FR-41 / FR-42：retry時のSession再開と失敗対象だけの再実行を検証する。
- FR-78 / FR-79 / FR-81：batch / anchor / Tool trace / resolutionの参照整合性を実PostgreSQLで検証する。

## 実装メモ

- `reflection_tool_executions`を追加し、target / batch / anchor scopeごとにTool callを1 rowで保存する。retryはscopeのtraceを置換し、旧JSONは処理完了時またはbackfill時にNULL化する。
- Session初期snapshot、Reconciliation anchor、先行pass後のtarget入力は`reflection_runs.input`だけへ保存する。子recordはselectorだけを持ち、監査専用snapshotはLLM入力から除外する。
- 旧所有者列とTool JSON列は#045のdata migration・rollback比較までnullable互換列として残す。新writer/readは親Sessionと新relationを正本にする。
- Drizzle migrationは`0038_jazzy_black_panther.sql`と`0039_early_black_tom.sql`。runtime role権限は`pnpm db:grant:reflection-tools`、旧trace移行はdry-run既定の`pnpm reflection:tools:backfill`を使用する。
- 検証：unit / contract 238件、integration 58件（実PostgreSQL）、system 54件、typecheck、trace check ERROR 0。repository全体のlintにはIssue外の既知違反が残る。
- 独立レビュー：`docs/work/reviews/2026-11-14-issue-042.md`（CRITICAL 0 / HIGH 0 / MEDIUM 0）。仕様照合：`docs/work/analyze/2026-11-14-change-issue-042.md`（全重大度0）。
- 全Event経路の実DB動作検証は、永続化writer切替後に一度だけ正しく評価できるよう#045へ追加した。

## 上流への反映

- `spec/personal-agent-implementation-design-v2.md`：Reflection Session監査保存を反映済み。
- `docs/AGENT_MOTIVATION_MODEL.md`：親snapshot、selector、Tool trace relationの関係図を反映済み。
