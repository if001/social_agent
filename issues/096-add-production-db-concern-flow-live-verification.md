---
created_at: 2026-11-26
status: doing
type: change
plan: []
requirements: [FR-24, FR-25, FR-69, NFR-6, NFR-8]
ui: []
requires: agent
---

# 096 本番DBでConcern flowを実LLM検証する

## Background

既存のlive E2Eは実Ollamaと本番PostgreSQLクラスタを使うが、`live_e2e_*` の隔離databaseで実行する。本番アプリDBのschemaで、Experience Integrationからexperience batch、concern-dueまでが実際に通る検証はない。

## Scope

- `LIVE_PRODUCTION_DB_TEST=true` を明示した時だけ、本番`POSTGRES_URL`へ隔離した`live-production-*` Agent/Concern/Eventを作るlive E2Eを追加する。
- 実Ollamaでuser-message、Experience Integration、Memory/experience batch、Schedulerのconcern-due、commitを検証する。
- 外部Discord配送は使わず、in-memory queueで検証する。
- 検証終了後に隔離Agentに属する行を削除する。

## Out of scope

- `shiro` / `aka` の既存データを入力・更新すること。
- 通常の`pnpm test:live`で本番DBへ書込むこと。

## Acceptance criteria

- [ ] AC-096-1：明示フラグなしでは本番DB E2Eはskipされる。
- [ ] AC-096-2：明示フラグありでは実OllamaによるExperience Integrationが完了し、event experienceとMemory/experience batchの結果を本番DBで検証できる。
- [ ] AC-096-3：pending batchが形成された場合、Schedulerが一度だけclaimしconcern-dueのcommit/consume又はretry状態を確認できる。
- [ ] AC-096-4：検証用Agentに属するデータをcleanupし、通常Agentのデータを操作しない。
