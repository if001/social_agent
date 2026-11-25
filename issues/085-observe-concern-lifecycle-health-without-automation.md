---
created_at: 2026-11-25
status: done
type: feature
plan: []
requirements: [FR-25, NFR-12]
ui: []
requires: agent
---

# 085 Concern lifecycleの健全性を観測可能にする

元設計：[#083](083-design-concern-lifecycle-service-and-focused-integration.md)

## Dependencies

- #084 done

## Scope

- Agentごとに次の観測値を読取り専用で集計し、Debug UIで確認できるようにする。
  - active Concern数
  - create / derive / satisfied / abandonedの推移
  - progress / focus / reviewが長期間ないConcern
  - embedding近傍で類似しすぎるConcern群
  - createが継続しcloseが極端に少ない状態
- 指標はConcern lifecycleの確認・運用判断のためだけに表示する。

## Out of scope

- 指標を閾値としてConcern create / close / priorityを自動実行すること。
- active Concern件数の固定下限・上限。
- 意味の近接を単語一致だけで確定すること。

## Acceptance criteria

- [x] FR-25：ActivityとConcern状態から、作成・派生・満足・放棄・未進展をAgent単位で追跡できる。
- [x] NFR-12：Debug UIは読取り専用であり、指標表示がConcern状態を書き換えない。
- [x] 類似Concern候補はRAG / embedding近傍を候補取得に用い、統合・closeを自動確定しない。
- [x] create / closeの件数と比率は閾値や警告へ変換せず、そのまま表示する。将来の運用判断又は調整機構の入力候補であり、固定件数ルールへ変換しない。

## Tests

- FR-25：fixtureでActivity推移、未進展Concern、create偏重を集計するUnit testを追加する。
- NFR-12：Agent ownership filterとSELECT-only Debug UI queryを検証する。

## 実装メモ

- 未進展は「progress / focus / review ActivityがないConcern」を時刻とともに表示する。期間閾値を置かない。
- create偏重・close不足は評価せず、Activityのcreate / derive件数と、現在のsatisfied / abandoned件数を表示するだけとする。
- 類似Concernはembedding近傍の候補だけを表示し、閾値・統合・closeを自動化しない。

## 完了記録

- Debug UIに `Concern lifecycle（観測）` を追加した。現在のactive / satisfied / abandoned数、Activity集計、未進展候補、embedding近傍候補を読取り専用で表示する。
- `tests/unit/debug-ui.test.ts` の `FR-25` fixtureでActivityと現在status数を確認し、`NFR-12` testで追加queryのAgent ownershipとSELECT-onlyを確認した。
- 検証: `pnpm test`（294 passed）、`pnpm typecheck`、`pnpm lint`、`trace_check.py`（ERROR 0、既存WARN 8）。
- レビュー: `docs/work/reviews/2026-11-25-issue-085.md`。
