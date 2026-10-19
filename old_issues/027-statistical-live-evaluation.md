---
created_at: 2026-10-03
status: created
---

# 027: 必要時にLive Scenarioの反復評価を実施する

## Goal

モデル、Prompt、Scenarioをrelease候補として固定した時点で、非決定的出力の再現性を統計的に確認する。

## Scope

- Issue 026で1回確認済みのScenarioだけを対象にする。
- Scenarioごとの必要性と費用を確認し、対象と反復数を実行計画へ明記する。
- 5回反復するScenarioではHard assertionの全run合格とSemantic 4/5以上を判定する。
- 中断・timeout後に完了済みpacketを再利用して再開する。
- 境界結果を人間reviewし、model、prompt、build、所要時間を記録する。

## Execution condition

通常開発の完了条件には含めない。release候補のmodelとPromptが固定され、反復評価の時間と費用を許容できる場合に実行する。

## Acceptance criteria

- [ ] 対象Scenarioと反復数の根拠が記録される。
- [ ] 実行対象の全Hard assertionが合格する。
- [ ] 5回実行したScenarioはSemantic passが4回以上となる。
- [ ] timeout、Schema不適合、意味評価失敗が段階別に集計される。

## Dependencies

- 026
