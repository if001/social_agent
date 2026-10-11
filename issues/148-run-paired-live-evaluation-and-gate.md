---
created_at: 2026-10-11
status: created
---

# 148: 対照試験を各variant 3回以上実行し自律性の合否を記録する

優先度: P0

## Background

[敵対再レビュー](../note/adversarial-rereview-2026-10-11.md)の「指摘1・8、P0: 完了判定を正す」への対応。型とfrequency counterの存在は行動改善の証明ではない。修正後の実Ollama artifactとpair間の比較が必要である。

## Scope

- runnerにpair単位の分母、行動比率、baselineとの差、失敗内訳を実装する。
- 6 pairのbaseline/statefulをそれぞれ最低3回実Ollamaで実行する。
- 合格条件を実行前に固定し、配送・次state・Tool選択・期待する行動差をmerge gateへ含める。
- 実行metadata、入力、出力、trace、state delta、summaryと判定根拠をartifacts/evaluationへ保存する。

## Out of scope

- 結果に合わせた閾値の後付け変更、fake結果をlive証拠として利用すること、全provider比較。

## Implementation notes

- 146・147に加えP0境界修正149〜152の完了後に基準測定する。P1変更後は同条件で再評価する。
- モデル・temperature・seed（未対応なら明記）・revision・prompt/scenario version・設定を保存する。欠測・中断・再開を扱い、失敗を分母から除かない。
- 効果量と不確実性を併記し、単に差が非ゼロならpassとしない。未実行・不足・gate不合格を改善済みと報告しない。

## Acceptance criteria

- 全6 pair各variantに3回以上の試行結果があり、失敗も集計される。
- 同一artifactの再集計で同じ差分と判定を得る。
- 欠測、失敗、行動差不足ではgateが不合格となり、CLI終了値から検出できる。
- Live結果が不合格の場合も原因と未達条件を記録し、自律性改善のmergeを通さない。

## Tests

- 分布差、欠測、失敗分母、resume互換性、gateのpass/failのテスト。
- pnpm test:evaluationとpnpm eval:llmによる実測。
- 保存artifactからの再集計と秘密情報の非混入確認。

## Dependencies

- [146](146-define-state-dependent-paired-scenarios.md)
- [147](147-execute-live-evaluation-through-runtime.md)
- [149](149-gate-every-model-call-input.md)
- [150](150-account-actual-model-calls.md)
- [151](151-retain-target-motive-in-context.md)
- [152](152-reject-no-action-after-failed-tools.md)

## Source plan

- [敵対再レビュー（2026-10-11）: 指摘1・8、P0: 完了判定を正す](../note/adversarial-rereview-2026-10-11.md)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
