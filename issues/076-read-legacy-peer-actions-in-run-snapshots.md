---
created_at: 2026-11-23
status: done
type: change
plan: []
requirements: [FR-30, FR-82, NFR-7, NFR-8]
ui: []
requires: agent
---

# 076 Run snapshot内の旧peer Actionを互換読取りする

Issue 075で`respond.peer`を廃止した後、旧`agent_runs.input_snapshot`をExperience Integrationが再開すると、`recentExperiences[].steps[].action.peer`が現行のstrict Action schemaで拒否される。

## Scope

- Experience Integrationが永続Run snapshotを復元する境界で、旧respond Actionを現在の単一content形式へ変換する。
- 旧peer名・Discord IDを現在の配送指定へ引き継がない。
- 対象を既知の旧respond形式に限定し、無関係な未知fieldは引き続きschemaで拒否する。
- 新規保存形式やDB schemaは変更しない。
- `agent_runs`は過去の判断入力を残す監査正本であるため、この限定readerはpending解消後も歴史的snapshotの読取り境界として維持する。旧writerや旧配送経路は維持しない。

## Acceptance criteria

- [x] `recentExperiences`内の旧`respond.peer`を含むRun snapshotからpending Experience Integrationを復元できる。
- [x] 変換後Actionは`type`と単一`content`だけを持ち、peer metadataを持たない。
- [x] 未知のAction fieldを一般的に除去して受理しない。
- [x] `pnpm verify`が成功し、独立レビューに未解決の重要指摘がない。

## Tests

- FR-30, FR-82, NFR-7：旧peer Actionを含む`input_snapshot`をrepositoryが復元できるintegration test。
- NFR-8：既知でない余分なAction fieldはschema errorのままとするtest。

## 上流への反映

- 要件・設計の意味変更はない。NFR-7の歴史的Run監査とFR-82の再開経路を、現行Action境界へ復元する限定readerとして実装した。

## 実装メモ

- Git履歴上の旧`PeerResponseSchema`と同じtrim、最小長、最大長、strict key制約を局所互換schemaで検証し、一致した旧Actionだけを`{ type: "respond", content }`へ変換する。
- `persistentState`の既知の旧拡張除去と、旧peer Action変換後に`AgentCoreInputSchema`で全体を厳密検証する。
- unit testは正常変換、未知Action field、壊れたpeer、空白、上限超過、新旧field混在の拒否を検証した。integration testは実DBのpending Integration復元を検証した。
- `pnpm verify`成功：unit 286、integration 70、system 64、evaluation 15。
- ID検査：ERROR 0、今回の変更に起因するWARN 0（既存WARN 8）。
- 独立レビュー：`docs/work/reviews/2026-11-23-issue-076.md`。
- spec-analyze change：`docs/work/analyze/2026-11-23-change-076.md`（CRITICAL / HIGH 0）。
