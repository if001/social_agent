---
created_at: 2026-11-25
status: done
type: fix
plan: []
requirements: [FR-82, FR-92, NFR-7, NFR-8]
ui: []
requires: agent
---

# 088 Experience Integrationで旧named recipient Actionを復元可能にする

## Background

Issue 075以前の保存済みRunは、`respond.recipient` にallowlist peerの自然言語名を持てた。現行契約はBot宛mentionを生成せず、recipientを`user | channel`に限定する。そのため、旧RunのExperience Integration再開時に `AgentRunResultSchema` が歴史的なpeer名を拒否する。

## Dependencies

- Issue 075（done）
- Issue 087（done）

## Scope

- Run結果の復元境界だけで、旧named recipient Actionを単一contentの応答へ正規化する。
- 現行の`user`・`channel`は保持する。
- 旧peer名は再配送・Bot mentionに使わず、復元した履歴Actionから除外する。
- 実DB integration testで旧named recipientを含むfailed Integrationを復元できることを検証する。

## Out of scope

- 現行Action schemaへの任意recipient追加、Bot mention配送の復活。
- 既存Runの書換えやDB migration。

## Acceptance criteria

- [x] FR-82, NFR-7：旧peer名recipientを持つfailed Integrationを復元できる。`tests/integration/persistence.test.ts`。
- [x] FR-92, NFR-8：現行の`user | channel`以外のrecipientを新規出力として受理しない。`tests/unit/domain-contracts.test.ts`。
- [x] FR-82：旧peer名は復元Actionに残らず、配送先として再利用されない。`tests/integration/persistence.test.ts`。
- [x] Issue 087の旧`peer` Action復元を回帰させない。`tests/integration/persistence.test.ts`。

## Tests

- FR-82, NFR-7：実DB integration testで、旧named recipient Actionを持つRun resultを復元する。
- FR-92, NFR-8：現行Action schemaのpeer名recipient拒否を維持する既存contract testを実行する。

## 上流への反映

- 不要。FR-92が定める現行の単一Action・Bot mention禁止を変えず、過去監査Runの読取りだけを互換化する。

## 実装メモ

- 旧`respond.peer`と旧named recipientを同じ限定normalizerで扱う。`user | channel`はそのまま保持し、それ以外の有効な旧自然言語recipientは除去して単一本文Actionへ変換する。
- 正規化はExperience Integrationが`agent_runs.result`を読む時だけであり、保存済みRunを書き換えず、配送も実行しない。
- 検証：実DB integration 76件、`pnpm test` 295件、`pnpm typecheck`、`pnpm lint`、ID trace check（ERROR 0、既存WARN 8）。
- レビュー：`docs/work/reviews/2026-11-25-issue-088.md`。要件・受入条件に関わる未解決指摘なし。
