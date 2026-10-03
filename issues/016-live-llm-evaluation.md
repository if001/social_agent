---
created_at: 2026-10-02
status: created
---

# 016: Live Ollama Scenario Evaluationを実装・実行する

## Goal

非決定的な意味判断が、事前配置した経験・現在状態を適切に利用し、短期状態と制約を扱えるか評価する。

## Scope

- EV-01〜EV-07のversion付きfixtureとrunner
- hard assertion、semantic rubric、evaluation packet
- Evaluator adapter、人間review入力、artifact保存
- Cloud ChatとLocal Embeddingのmodel / endpoint / version metadata

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-16
- `docs/TEST_STRATEGY.md` 11、14、16、19章
- `docs/REQUIREMENTS.md` AC-01〜AC-07

## Acceptance criteria

- [ ] 実際のAgent Coreへ入力し、評価専用PromptでAgentの振る舞いを模擬しない
- [ ] 開発確認として1 Scenarioを1回実行し、Schemaと意味内容を確認できる
- [ ] 7 Scenarioを独立初期状態から各5回実行できる
- [ ] Hard assertionは全runで合格する
- [ ] 各Scenarioで5回中4回以上がsemantic rubricの総合passとなる
- [ ] 長期状態の自然な形成を短時間の合否条件に含めない
- [ ] 入力、状態差分、根拠Memory、Tool traceを追跡できる
- [ ] model、endpoint、prompt、build、configを記録し、API keyは除外する
- [ ] 過去artifactを上書きせず、境界結果を人間reviewできる

## Tests

- runner、assertion、rubric集計、artifact生成の決定的テスト
- `pnpm eval:llm`によるEV-01〜EV-07

## Dependencies

- 015
