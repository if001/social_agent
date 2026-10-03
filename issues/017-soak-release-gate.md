---
created_at: 2026-10-02
status: created
---

# 017: Evaluation Store、実利用評価、完成判定を実施する

## Goal

実時間利用における個体化、自律性、安定性、データ成長、ユーザー体感を確認して完成判定する。

## Scope

- Evaluation periodと通常Memoryから分離したFeedback Store
- feedback追加 / 一覧 / 修正 / export CLI
- 定期snapshot、期間集計、feedbackとtraceの照合
- 実利用期間のreport generator、ユーザーフィードバックと関連traceの照合

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-17、Project completion gate
- `docs/TEST_STRATEGY.md` 12、13、17、19章

## Acceptance criteria

- [ ] feedbackがAgentのMemory、Context、状態へ自動反映されない
- [ ] reportから開始・終了状態、Review根拠、自律行動、Tool、Queue、失敗を追跡できる
- [ ] reportとartifactに秘密値を含めない
- [ ] Terminal、Discord、複数botのManual Smokeが成功する
- [ ] 固定日数によらない実利用期間についてTest Strategy 12.7の記録条件を満たす
- [ ] 評価対象の各Agentに1件以上のfeedbackがあり、観測できた印象、望ましい振る舞い、判断材料が不足する項目を記録する
- [ ] Completion Gate全項目と未解決リスクをSoak Reportへ記録する

## Tests

- Feedback Store、期間集計、秘密値除外、期間比較、report生成のfixture test
- 実利用期間の収集とreport生成
- feedbackと関連conversation、Event、runの照合

## Dependencies

- 016
- Terminal、Discord、複数botのManual Smoke成功
