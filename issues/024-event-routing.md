---
created_at: 2026-10-03
status: created
---

# 024: Eventを通常CoreとLong-term Reviewへ振り分ける

## Background

External・Time・Internal Eventを入口として、通常loopと長期Reviewを適切に起動する必要がある。

## Dependencies

[023](023-long-term-review-flow.md)

## Scope

- 通常Eventとlong-term-reviewの振り分けをRuntime/Schedulerへ接続する。
- Intention再検討や状態レビュー、Candidate蓄積に応じたReview機会をdocsに従って生成する。
- Agent単位の直列化、重複発火、実行中Review、再起動復旧を整合する。

## Out of scope

- 固定周期だけによる長期状態の自動変更
- LLMによる無制限な自己起動

## Implementation notes

- Runtimeが再検討の機会を与え、意味判断は対応するCoreが行う。
- Tool結果は内部loopで処理済みかを識別し、記録による二重処理を避ける。

## Acceptance criteria

- [ ] 通常Eventは通常Core、long-term-reviewはReview Coreへ到達する。
- [ ] Reviewと通常更新の競合や同一Eventの二重適用を防ぐ。
- [ ] 再起動後も予約・Candidateを失わず再検討できる。

## Tests

- Fake Clockによる発火・振り分け・wait再開・重複防止。
- System testで通常処理→Candidate保存→Internal Event→Review確定を確認する。

## References

- 元計画: [IMPLEMENTATION_PLAN](../docs/IMPLEMENTATION_PLAN.md)（IP-02、06–12、15–17）
- 一次情報: [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- 一次情報: [実装設計](../spec/personal-agent-implementation-design-v2.md)（18–26、29章）
- [Architecture](../docs/ARCHITECTURE.md) / [Requirements](../docs/REQUIREMENTS.md) / [Test Strategy](../docs/TEST_STRATEGY.md)

実装時はIssueごとにbranchを作成し、完了条件を満たした後にstatusをdoneへ変更してmainへマージする。今回はIssue作成のみ。
