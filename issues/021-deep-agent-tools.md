---
created_at: 2026-10-03
status: created
---

# 021: Tool実行をDeep Agent内部へ統一する

## Background

Deep Agent内部Tool実行と最終actionによる外部ToolLoopが混在している。

## Dependencies

[020](020-agent-proposal-contracts.md)

## Scope

- 登録済みToolを実行可能なtool listとしてDeep Agentへ渡すadapterを実装する。
- 許可されたToolだけを公開し、期限・呼び出し回数・キャンセルをコードで制御する。
- 実行ID、入力、成否、結果参照、時刻、run/eventとの対応を実行記録として収集する。
- 旧ToolLoop方式を廃止・移行し、Tool結果を受けたCoreの継続判断を確認する。

## Out of scope

- 新しいTool機能の追加
- DBへの記録確定処理

## Implementation notes

- 実行記録はLLMに再生成させない。callbackだけで制限を保証せず、実行wrapper等で強制する。
- 組み込みToolを含め実際に公開される能力を確認する。副作用のあるToolの冪等性キーを定義する。
- 根拠に採用したかはcallbackから断定せず、提案の根拠参照との対応で扱う。

## Acceptance criteria

- [ ] Tool要求から結果の再入力・最終出力まで内部loopで完了する。
- [ ] 不許可Tool、回数超過、期限超過を実行境界で防げる。
- [ ] 成功・失敗・途中終了の履歴を取得できる。

## Tests

- 決定的model/tool doubleで複数Tool、失敗後の判断、上限、キャンセルを検証する。
- 同じ副作用Toolの再試行時の重複防止を検証する。

## References

- 元計画: [IMPLEMENTATION_PLAN](../docs/IMPLEMENTATION_PLAN.md)（IP-02、06–12、15–17）
- 一次情報: [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- 一次情報: [実装設計](../spec/personal-agent-implementation-design-v2.md)（18–26、29章）
- [Architecture](../docs/ARCHITECTURE.md) / [Requirements](../docs/REQUIREMENTS.md) / [Test Strategy](../docs/TEST_STRATEGY.md)

実装時はIssueごとにbranchを作成し、完了条件を満たした後にstatusをdoneへ変更してmainへマージする。今回はIssue作成のみ。
