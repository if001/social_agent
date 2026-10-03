---
created_at: 2026-10-02
status: done
---

# 016: Live Ollama Scenario Evaluationを実装・実行する

## Goal

Live評価基盤を実装し、代表Scenarioを1回実行して、実際のAgent Coreが期待Schemaと意味内容を返せることを確認する。

## Scope

- EV-01〜EV-07のversion付きfixtureとrunner（このIssueでのLive実行はEV-01を1回）
- hard assertion、semantic rubric、evaluation packet
- Evaluator adapter、人間review入力、artifact保存
- Cloud ChatとLocal Embeddingのmodel / endpoint / version metadata

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-16
- `docs/TEST_STRATEGY.md` 11、14、16、19章
- `docs/REQUIREMENTS.md` AC-01〜AC-07

## Acceptance criteria

- [x] 実際のAgent Coreへ入力し、評価専用PromptでAgentの振る舞いを模擬しない
- [x] EV-01を1回実行し、Schemaと意味内容を個別に確認できる
- [x] EV-01のHard assertion 6項目がすべて合格する
- [x] EV-01のsemantic rubric 5項目がすべて合格する
- [x] 長期状態の自然な形成を短時間の合否条件に含めない
- [x] 入力、状態差分、根拠Memory、Tool traceを追跡できる
- [x] model、endpoint、prompt、build、configを記録し、API keyは除外する
- [x] 過去artifactを上書きせず、境界結果を人間reviewできる

## Tests

- runner、assertion、rubric集計、artifact生成の決定的テスト
- `EVALUATION_SCENARIO_ID=EV-01 EVALUATION_REPETITIONS=1 pnpm eval:llm`

## Dependencies

- 015

## Result and follow-up

Live group `2026-10-03T10-22-24-447Z-4107a32f-efda-4d3d-bcdf-61d504b6fff6`でEV-01を1回実行し、Schema、Hard assertion、Semantic rubricがすべてpassした。残り6 Scenarioの契約整合と各1回の確認はIssue 026、反復実行による統計的評価はIssue 027へ分離する。
