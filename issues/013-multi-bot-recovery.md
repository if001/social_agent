---
created_at: 2026-10-02
status: created
---

# 013: Multi-bot通信、冪等性、障害復旧を実装する

## Goal

個体分離を保ちながらAgent間で情報を伝達し、連鎖と停止中配送を安全に扱う。

## Scope

- `agent_send`、agent-message payload / provenance、返信先
- hop count、TTL、受信側External Event
- 複数process構成とTool idempotency
- dead-letter一覧・再投入CLI、障害位置別の復旧

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-13
- `docs/ARCHITECTURE.md` 8.3、11、12、14.2、15章
- `docs/TEST_STRATEGY.md` ST-05、ST-06

## Acceptance criteria

- [ ] BはAの情報を伝聞として保存し、AのMemoryを複製しない
- [ ] 同一Message / Tool callの再処理で副作用を重複させない
- [ ] 一方のbot停止中のMessageを再起動後に処理できる
- [ ] hop / TTL上限でbot間連鎖を停止する
- [ ] dead-letterを理由付きで一覧・再投入できる

## Tests

- ST-05 bot間通信
- ST-06のpending、processing、commit前後、outbox publish前後の停止
- Agent lock、TTL、hop、idempotency integration test

## Dependencies

- 005
- 009
- 010
