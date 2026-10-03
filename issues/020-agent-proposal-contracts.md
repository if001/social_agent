---
created_at: 2026-10-03
status: created
---

# 020: 通常Coreの提案契約と日本語プロンプトを整理する

## Background

通常Coreが保存用IDや時刻まで生成する現行契約は責務が混在し、型不適合の修正を難しくしている。

## Dependencies

[019](019-audit-implementation.md)

## Scope

- 通常出力を意味づけ・内部変更提案・最終行動として整理する。
- 新規Memory・Intention・CandidateのID、所有者、時刻をLLM生成対象から外す。
- 最終行動からtoolを外し、AgentRunResultで出力と実行記録を分離する。
- 日本語プロンプトに目的、入力、全出力フィールド、enum、更新不要時の空配列、最小例を記載する。
- 利用箇所とテストダブルを新契約へ移行し、後続配線に必要な互換性を保つ。

## Out of scope

- Tool実行エンジンの統合
- 長期Reviewの実配線

## Implementation notes

- 更新対象の既存IDと新規保存時の生成IDを区別する。新規提案間の根拠参照方法を定義する。
- 型を単に入れ子へ変更するだけでなく、検証可能な提案契約を確定する。通常Coreは長期状態を直接変更しない。

## Acceptance criteria

- [ ] LLMが保存用メタデータを生成せずに有効な提案を返せる。
- [ ] 必要な既存対象・根拠参照を検証できる。
- [ ] 全出力フィールドの意味と例が日本語で説明される。

## Tests

- 新規・既存更新、空更新、不正enum、他Agent参照の契約テスト。
- 型チェックと影響範囲の既存テスト。

## References

- 元計画: [IMPLEMENTATION_PLAN](../docs/IMPLEMENTATION_PLAN.md)（IP-02、06–12、15–17）
- 一次情報: [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- 一次情報: [実装設計](../spec/personal-agent-implementation-design-v2.md)（18–26、29章）
- [Architecture](../docs/ARCHITECTURE.md) / [Requirements](../docs/REQUIREMENTS.md) / [Test Strategy](../docs/TEST_STRATEGY.md)

実装時はIssueごとにbranchを作成し、完了条件を満たした後にstatusをdoneへ変更してmainへマージする。今回はIssue作成のみ。
