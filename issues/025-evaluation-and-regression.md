---
created_at: 2026-10-03
status: created
---

# 025: 新しいフローの回帰検証と1シナリオ1回のLive評価を行う

## Background

旧出力契約に依存した評価を更新し、まず小さな実行で型と内容の妥当性を確認する。

## Dependencies

[024](024-event-routing.md)

## Scope

- 評価executor・成果物・評価プロンプトを新契約とTool実行記録へ対応する。
- 通常フローとReviewフローの決定的回帰テストを実行する。
- 通常Coreの1シナリオ×1回を実行し、入力・出力・期待意味・参照specを記録する。
- 019の差分表を更新し、既存016・017の残作業と再開条件を明記する。

## Out of scope

- 全シナリオ×5回の一括実行
- 短い会話だけでのMood・人格・関係性の長期形成の合否判定

## Implementation notes

- schema適合と内容妥当性を別に評価する。失敗時は段階別LLM回数・時間・入力長・検証エラーで原因を記録する。
- .envは内容を表示・手動参照せず実行プロセスで読み込み、変更は.env.sampleだけとする。OllamaまたはDBへ接続できなければ作業を止めて報告する。
- 長期形成は実利用の感想で後に評価し、観測不足を失敗と混同しない。

## Acceptance criteria

- [ ] 新契約・Tool・通常更新・Reviewの回帰検証結果が記録される。
- [ ] 1シナリオ×1回で期待型と期待内容を個別に判定できる。
- [ ] 残差分と016・017の未完了事項が追跡でき、未検証をdoneにしない。

## Tests

- 型チェック・lint・関連Unit/Contract/System/Integration。
- OllamaとDB接続確認後の1シナリオ×1回Live評価。

## References

- 元計画: [IMPLEMENTATION_PLAN](../docs/IMPLEMENTATION_PLAN.md)（IP-02、06–12、15–17）
- 一次情報: [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- 一次情報: [実装設計](../spec/personal-agent-implementation-design-v2.md)（18–26、29章）
- [Architecture](../docs/ARCHITECTURE.md) / [Requirements](../docs/REQUIREMENTS.md) / [Test Strategy](../docs/TEST_STRATEGY.md)

実装時はIssueごとにbranchを作成し、完了条件を満たした後にstatusをdoneへ変更してmainへマージする。今回はIssue作成のみ。
