---
created_at: 2026-10-02
status: created
---

# 012: Long-term Reviewとcompactionを実装する

## Goal

経験を根拠付きで長期状態へ昇格し、個体化と状態肥大化抑止を両立する。

## Scope

- Candidateとevidenceの保存
- Review input / prompt / output、KEEP / UPDATE / MERGE / DROP
- Self Narrative優先更新、Acquired Disposition更新制約
- Self Change Memory、Candidate解決、compaction、review trigger

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-12
- `docs/ARCHITECTURE.md` 5.11
- `docs/REQUIREMENTS.md` FR-LR
- `docs/TEST_STRATEGY.md` EV-06

## Acceptance criteria

- [ ] Long-term Reviewだけが許可された長期状態を変更する
- [ ] evidenceは実在し、同じAgentに属する
- [ ] KEEP / UPDATE / MERGE / DROPを処理できる
- [ ] 更新、Candidate状態、Self Change Memoryを同一transactionで確定する
- [ ] MERGE / compactionにより単純追加の無制限成長を避ける

## Tests

- Scripted Review Harnessによる4判断、所有権、rollback、MERGE、compaction
- before / afterから根拠Memoryまでの追跡テスト

## Dependencies

- 006
- 008
- 009
- 011
