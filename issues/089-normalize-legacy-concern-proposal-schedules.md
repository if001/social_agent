---
created_at: 2026-11-25
status: done
type: fix
plan: []
requirements: [FR-24, FR-82, NFR-7, NFR-8]
ui: []
requires: agent
---

# 089 Experience Integrationで旧Concern proposal scheduleを復元可能にする

## Background

Issue 078でConcernごとの時刻scheduleと`reconsiderAt`を廃止し、Memory等の意味的signalによる`concern-due`へ移行した。旧`agent_runs.result.concernProposals`が`reconsiderAt`を持つと、現在のstrict `ResolvedConcernProposalSchema`でExperience Integrationの履歴復元が失敗する。

## Dependencies

- Issue 078（done）
- Issue 087（done）
- Issue 088（done）

## Scope

- Run結果の復元境界で、各旧Concern proposalから既知の廃止field `reconsiderAt` だけを除去する。
- 旧時刻をschedule・signal・Concern状態として再生成しない。
- 実DB integration testで旧fieldを持つfailed Integrationを復元できることを検証する。

## Out of scope

- 現行Concern proposal schemaへの`reconsiderAt`復活。
- 既存Runの書換え、旧Concern scheduleの再作成、DB migration。
- 任意の未知proposal fieldの除去。

## Acceptance criteria

- [x] FR-82, NFR-7：旧`reconsiderAt`付きConcern proposalを持つfailed Integrationを復元できる。`tests/integration/persistence.test.ts`。
- [x] FR-24：旧`reconsiderAt`からScheduleやsignalを再生成しない。復元はJSON parseだけであり、schedule / signal repositoryを呼ばない。
- [x] NFR-8：`reconsiderAt`以外の未知proposal fieldを一般的に除去して受理しない。normalizerは既知keyだけを除き、結果をstrict schemaで検証する。
- [x] Issue 087・088の旧Action互換読取りを回帰させない。`tests/integration/persistence.test.ts`。

## Tests

- FR-82, NFR-7：実DB integration testで、旧`reconsiderAt`を含むRun resultを復元し、復元結果にfieldが残らないことを確認する。
- FR-24：復元はRun結果のparseだけで、schedule / signal writerを実行しないことをrepository境界で確認する。

## 上流への反映

- 不要。#078で確定済みのsignal方式と現行schemaを変えず、旧監査Runの限定readerを補うだけである。

## 実装メモ

- `normalizeLegacyRunResult` が旧Actionと同じ復元境界で`concernProposals[]`を走査し、既知の廃止field `reconsiderAt` だけを除去する。
- 保存済みRun、Concern、Schedule、Signalは更新しない。Experience Integrationは正規化した監査結果を読むだけである。
- 実DB integration testをred（`reconsiderAt`がstrict schemaで失敗）からgreen（76件成功）へ進めた。
- 検証：`pnpm test:integration -- tests/integration/persistence.test.ts`（76件）、`pnpm typecheck`、`pnpm lint`、ID trace check（ERROR 0、既存WARN 8）。
- レビュー：`docs/work/reviews/2026-11-25-issue-089.md`。要件・受入条件に関わる未解決指摘なし。
