---
created_at: 2026-11-25
status: done
type: fix
plan: []
requirements: [FR-82, NFR-7, NFR-8]
ui: []
requires: agent
---

# 087 Experience Integrationで旧peer Actionを復元可能にする

## Background

Issue 076 は `agent_runs.input_snapshot.recentExperiences` 内の旧 `respond.peer` を現行Actionへ正規化した。しかし、同じ旧形式が `agent_runs.result.output.action` に残る場合、Experience Integration が pending / failed Integration を再開すると、strict な `AgentRunResultSchema` が `peer` を未知fieldとして拒否する。これは旧Run監査を読む復元境界の不具合であり、新規Action schemaや配送経路を戻す理由にはならない。

## Dependencies

- Issue 076（done）

## Scope

- Experience IntegrationのRun復元時に限り、既知の旧 `respond` + `peer` Actionを現行の単一 `content` Actionへ正規化する。
- `input_snapshot` と `result` の両方で同じ限定的な旧Action正規化を再利用する。
- 実DB integration testで、旧 `result.output.action.peer` を持つfailed Integrationを復元できることを検証する。

## Out of scope

- 現行 `AgentRunResultSchema` の緩和、旧 `peer` writer・Bot mention配送の復活。
- 既存 `agent_runs` の一括書換え・migration。
- 既知形式以外の未知Action fieldの一般的な除去。

## Acceptance criteria

- [x] FR-82, NFR-7：旧 `agent_runs.result.output.action.peer` を含むpending / failed Integrationを現行Run結果として復元できる。`tests/integration/persistence.test.ts`。
- [x] NFR-8：既知の厳密な旧peer Actionだけを変換し、未知fieldや壊れた旧形式はstrict schema errorのままとする。既存 `tests/unit/experience-integration.test.ts` と共有normalizer。
- [x] FR-82：復元後のActionは `type` と単一 `content` だけで、peer metadataを持たない。`tests/integration/persistence.test.ts`。
- [x] 現行Run結果と旧input snapshot互換読取りを回帰させない。unit 295件、integration 76件。

## Tests

- FR-82, NFR-7：実DB integration testで、旧 `result.output.action.peer` を保存したfailed Integrationを復元する。
- NFR-8：既存unit testの既知形式限定変換・未知field拒否を、result復元も同じnormalizerを通ることで維持する。

## 上流への反映

- 不要。FR-82 / NFR-7 / NFR-8が定める監査Runの再開とstrict境界の実装漏れを修正するだけであり、要件の意味は変更しない。

## 実装メモ

- `normalizeLegacyPeerAction` をinput snapshotとRun resultで共用し、既知のstrictな旧`respond.peer`だけを単一`content`へ変換する。
- 実DB integration testをred（旧resultで復元失敗）からgreen（76件成功）へ進めた。
- 検証：`pnpm test`（295件）、`pnpm test:integration -- tests/integration/persistence.test.ts`（76件）、`pnpm typecheck`、`pnpm lint`、ID trace check（ERROR 0、既存WARN 8）。
- レビュー：`docs/work/reviews/2026-11-25-issue-087.md`。要件・受入条件に関わる未解決指摘なし。
