---
created_at: 2026-11-08
status: done
type: fix
plan: []
requirements: [C-06, C-23, C-24]
requires: agent
---

# 019 Context選択でConcernを失わせない

元計画：なし（shiroの稼働データ調査）

## Background

shiroではconcern-formationがactive Concernを作成しているにもかかわらず、次の形成Eventの入力断面でactiveが0件に戻っていた。直近の作成Concernは`status: satisfied`への変更記録を持たず、状態から消えている。

調査の結果、Reflectionの合成処理ではなく、`ContextBuilder` がConcernを先頭12件へ切り詰めた状態をRuntimeの更新基準にも使っていることが原因だった。shiroでは先頭12件が`satisfied`であり、後ろに追加されたactive Concernが次の通常Event commitで落ちていた。

Concernは次のEventにも影響する持続状態であり、Context選択はモデルへ渡す情報を絞っても、Runtimeが確定する永続状態を失わせてはならない。

## Dependencies

- 015

## Scope

- ContextBuilderが12件を超えるConcernを持つ入力でも、Runtime commit用の状態を欠損させない回帰テストを追加する。
- Context選択でConcernを切り詰めず、次EventのConcern proposalが既存Concernを保持したまま反映されるよう修正する。
- active Concernが12件より後ろにあっても、次Event後に保持されることを検証する。

## Out of scope

- Concernの件数下限や機械的なactive件数制御。
- Reflectionによるsatisfied / abandoned判断基準の変更。
- 既に失われたshiroのConcern履歴の復旧。

## Implementation notes

- `satisfied`への遷移は、明示的な`derive + replace`またはReflectionの対象Concernへのupsertだけが行う。
- Contextのtoken制約と、永続Stateの完全性を混同しない。
- Runtimeの既存version競合検出を維持する。

## Acceptance criteria

- [x] C-06：12件より後ろにあるactive Concernを含め、Concernが次Event後も持続する。
- [x] C-24：通常EventのConcern proposalは、Context選択で除外されたConcernを暗黙に削除または終了しない。
- [x] C-23：Context Builderが選択済みContextを構成しても、Runtime commitの基準となるConcern集合を欠損させない。

## Tests

- C-06, C-23, C-24：`tests/unit/memory-context.test.ts`で、12件を超える長文Concernの件数・本文をContextBuilderが欠損させず、モデル用token budgetを超過させないことを検証する。
- C-06, C-24：`tests/integration/persistence.test.ts`で、12件より後ろのactive Concernを含む状態へ通常EventのConcern proposalをcommitし、全Concernが保持されることを検証する。

## 影響範囲

検索した語：`applyConcerns`、`concernChanges`、`agent_states.concerns`、`concern-due`、`Reflection`。

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/application/context-builder.ts` | Context選択時のStateの扱い | 更新する |
| `tests/integration/persistence.test.ts` | Reflection永続化の統合検証 | 更新する |
| `tests/unit/memory-context.test.ts` | ContextBuilderの状態保持 | 更新する |
| `src/application/agent-state-patch.ts` | 通常Eventのderive / replace | 更新しない（完全なStateで適用可能） |
| `skills/concern-lifecycle/SKILL.md` | Concern終了の判断規則 | 更新しない（規則ではなく永続化不具合） |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` C-06 | 既存の持続状態の定義を実装修正が満たす | 不要 |
| `spec/personal-agent-implementation-design-v2.md` C-23, C-24 | Context選択とRuntime検証の既存定義を実装修正が満たす | 不要 |

## 実装メモ

- ContextBuilderはConcern集合をRuntime commitの基準として完全に保持し、モデルへ送らない`state`はContext token budgetから除外した。
- C-06, C-23, C-24の回帰を`tests/unit/memory-context.test.ts`と`tests/integration/persistence.test.ts`で検証した。
- 検証: `pnpm test -- --runInBand`（199件）、PostgreSQL integration（29件）、`pnpm typecheck`、対象ESLint。
- ID機械検査には既存の重複定義ERROR 5件とWARN 2件があるが、本Issueによる追加はない。
- レビュー記録: `docs/work/reviews/2026-11-08-issue-019.md`。
