---
created_at: 2026-10-02
status: done
---

# 011: Scheduler、Intention、自律行動を実装する

## Goal

保存済み状態から再検討機会を生成し、ユーザー入力なしの行動を上限付きで実現する。

## Scope

- Intention lifecycleと`next_review_at`
- due scan、Time / Internal Event、persistent Drive再評価
- default output destination、Scheduler lifecycle、多重起動防止

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-11
- `docs/ARCHITECTURE.md` 5.10、6.2、8.4
- `docs/TEST_STRATEGY.md` 7.4、7.5、ST-04

## Acceptance criteria

- [ ] dueな対象だけからRuntime内部Eventを生成する
- [ ] Agent Coreが自分自身を直接再起動できない
- [ ] 同じ対象を連続起動せず、stopping中に新しいrunを開始しない
- [ ] wait / no-actionで余計な内部runを生成しない
- [ ] 外部通知が必要なActionだけを既定宛先へpublishする

## Tests

- Fake Clockによる期限、状態遷移、多重起動、停止処理のunit test
- ST-04 Internal Event

## Dependencies

- 006
- 009
