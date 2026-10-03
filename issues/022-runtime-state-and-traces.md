---
created_at: 2026-10-03
status: created
---

# 022: Runtimeで提案とTool実行記録を確定する

## Background

内部Toolの実行結果と通常Coreの提案を保存・配送へ接続する必要がある。

## Dependencies

[021](021-deep-agent-tools.md)

## Scope

- Runtimeで提案へID・時刻・所有Agentを付与し、状態・Memory・Intention・Candidateを検証して保存する。
- Tool実行記録をEvent・根拠と関連づけ、後続のMemoryと障害調査から参照可能にする。
- respond・refuse・wait・no-actionごとの配送・予約・無配送の意味をdocsに従って実装する。
- transaction、outbox、重複受信・再試行、途中失敗時の扱いを整合する。

## Out of scope

- 長期状態の更新判断
- 新しいUI機能

## Implementation notes

- DB rollbackで外部Toolの副作用は取り消せない。最終出力の失敗時にも実行事実を失わない記録境界を設計する。
- Tool結果を記録しただけで同じCoreを二重起動しない。既存スキーマ変更が必要ならmigrationを含める。

## Acceptance criteria

- [ ] 有効な提案だけが対象Agentへ保存され、通常処理から長期状態を直接変更できない。
- [ ] Tool実行から出力・Memoryまで根拠を追跡できる。
- [ ] 不正出力や重複受信で状態更新・配送・Tool副作用が重複しない。

## Tests

- DB integrationでcommit・rollback・所有権・重複受信を検証する。
- System testでTool使用後の応答と最終出力失敗時の実行記録を確認する。

## References

- 元計画: [IMPLEMENTATION_PLAN](../docs/IMPLEMENTATION_PLAN.md)（IP-02、06–12、15–17）
- 一次情報: [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- 一次情報: [実装設計](../spec/personal-agent-implementation-design-v2.md)（18–26、29章）
- [Architecture](../docs/ARCHITECTURE.md) / [Requirements](../docs/REQUIREMENTS.md) / [Test Strategy](../docs/TEST_STRATEGY.md)

実装時はIssueごとにbranchを作成し、完了条件を満たした後にstatusをdoneへ変更してmainへマージする。今回はIssue作成のみ。
