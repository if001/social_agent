---
created_at: 2026-10-03
status: done
---

# 019: 確定したdocsと実装の対応を調査する

## Background

既存IssueのdoneだけではRuntimeの実配線まで保証できないため、修正前に到達可能な実行経路と文書の対応を確認する。

## Dependencies

[018](018-align-design-documents.md)

## Scope

- 修正済みdocsを基準にsrc/・tests/・起動経路・永続化を調査する。
- Core契約、Tool登録、Runtime、Scheduler、Review、評価について実装済み・部分実装・未実装を根拠付きで記録する。
- 差分を020–025へ割り当て、1セッションを超える変更は追加Issueに分割する。

## Out of scope

- 製品コード修正
- 大量のLive評価

## Implementation notes

- docs内に対応表を作り、要件節・コード位置・実行経路・既存テスト・不足・担当Issueを記す。
- ToolLoop単体テストの成功と本番配線の完成を区別する。既存016・017との重複と再開条件を整理する。

## Acceptance criteria

- [x] 対象docsの要求と実装の対応、不足、担当Issueが追跡できる。
- [x] 後続Issueの範囲と順序が監査結果で更新される。

## Tests

- 対応表のコード参照と起動から呼び出し先までの到達性を確認する。

## References

- 元計画: [IMPLEMENTATION_PLAN](../docs/IMPLEMENTATION_PLAN.md)（IP-02、06–12、15–17）
- 一次情報: [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- 一次情報: [実装設計](../spec/personal-agent-implementation-design-v2.md)（18–26、29章）
- [Architecture](../docs/ARCHITECTURE.md) / [Requirements](../docs/REQUIREMENTS.md) / [Test Strategy](../docs/TEST_STRATEGY.md)

実装時はIssueごとにbranchを作成し、完了条件を満たした後にstatusをdoneへ変更してmainへマージする。今回はIssue作成のみ。
