---
created_at: 2026-11-27
status: done
type: change
plan: []
requirements: [FR-48, FR-49, FR-51, FR-62, FR-83, FR-84, NFR-16, NFR-20]
requires: agent
---

# 108 G3の最小入力契約と旧フィールドを整理する

## Background

G1/G2・G3契約の最小化後も、G3 promptがhumanだけを対象とし、`investigation.reason`が
独立した調査目的として渡されていない。またPrediction Loopの未使用Memory sinkと
`g3_tasks.plan`が残る。

## Scope

- G3の相手表現をhuman / peer双方に中立化する。
- G3入力をObservation、`investigation.reason`、必要最小限の予測評価へ明示的に分離する。
- 未使用のPrediction Loop Memory sinkと`g3_tasks.plan`を削除し、Drizzle migrationを生成する。
- 契約・system/integration testで起動理由、通常Event復帰、Experience Integrationへの接続を確認する。

## Out of scope

- G3のfinding / hypothesis意味の変更。
- G3のTool集合・call上限の変更。

## Acceptance criteria

- [x] peer directでもG3 promptが相手をuserと決めつけない。
- [x] G3が起動理由を独立fieldとして受け、Prediction全体を調査目的として扱わない。
- [x] G3入力から不要なPrediction candidate群を除く。
- [x] 未使用fieldを削除し、Drizzle生成migrationを含める。
- [x] G3 result Eventから通常Agent Loop、Experience Integrationまでの既存接続をSystem testで確認する。

## 実装メモ

- `tests/system/g3-event.test.ts`で、G3 resultをRuntime sinkへ渡し、result Eventのcommit失敗時は
  taskをretryableに保つことを確認した。Runtimeはcommit後にExperience Integrationをenqueueする。
- `0056`はDrizzle生成SQLをそのまま適用し、既存DBとの一時的な列差は直接SQLで調整した。
