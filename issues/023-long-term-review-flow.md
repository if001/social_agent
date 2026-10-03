---
created_at: 2026-10-03
status: created
---

# 023: Long-term Reviewの独立した判断と保存を実装する

## Background

持続性の高い内部状態は、通常イベントで保存したCandidateとMemoryを根拠に別フローで確定する。

## Dependencies

[022](022-runtime-state-and-traces.md)

## Scope

- 既存Review実装を監査済みdocsへ合わせ、通常Coreとは別の入力・出力・日本語プロンプトを用意する。
- KEEP・UPDATE・MERGE・DROP、根拠検証、Self Change Memory、compactionを接続する。
- Review結果・Candidate解決・長期状態を整合するtransactionで保存する。

## Out of scope

- Schedulerからの発火配線（024）
- 短期間での自然な人格形成の証明

## Implementation notes

- 通常Coreと同じモデルを使っても契約・コンテキスト・責務を分離する。
- 更新可能な長期対象は018で確定したdocsに従う。Roleや長期的関心を会話例だけで無条件に実装対象へ増やさない。

## Acceptance criteria

- [ ] 通常Coreとは独立してCandidateと実在する同一Agentの根拠を評価できる。
- [ ] 4判断の意味、統合、長期状態更新とSelf Change Memoryが整合する。

## Tests

- Scripted Reviewで4判断、根拠欠落・他Agent参照、rollback、重複適用、compactionを検証する。

## References

- 元計画: [IMPLEMENTATION_PLAN](../docs/IMPLEMENTATION_PLAN.md)（IP-02、06–12、15–17）
- 一次情報: [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- 一次情報: [実装設計](../spec/personal-agent-implementation-design-v2.md)（18–26、29章）
- [Architecture](../docs/ARCHITECTURE.md) / [Requirements](../docs/REQUIREMENTS.md) / [Test Strategy](../docs/TEST_STRATEGY.md)

実装時はIssueごとにbranchを作成し、完了条件を満たした後にstatusをdoneへ変更してmainへマージする。今回はIssue作成のみ。
