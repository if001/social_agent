---
created_at: 2026-10-02
status: created
---

# 006: State Update ServiceとEvent transactionを実装する

## Goal

LLMの提案を検証し、許可された変更だけをtrace付きで確定する。

## Scope

- short-term target / operation allowlistと所有権検証
- 長期状態の直接更新拒否、Intention / Memory / Candidate提案検証
- state version検証
- Event、run、state change、tool trace、receipt、outboxのtransaction orchestration

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-06
- `docs/ARCHITECTURE.md` 5.9、9、10.4、12章
- `docs/TEST_STRATEGY.md` 7.2、9.2

## Acceptance criteria

- [ ] 通常EventからIdentity、Shared / Acquired Disposition等を直接変更できない
- [ ] 別AgentのMemory、Intention、Social Contextを参照できない
- [ ] Schema不正、version競合、途中失敗で部分更新を残さない
- [ ] before / after / reason / evidenceをrunまで追跡できる

## Tests

- State Update Serviceのpublic seamで許可・禁止更新を検証
- Unit of Workのrollback、receipt、outbox atomicity

## Dependencies

- 002
- 004
