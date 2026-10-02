---
created_at: 2026-10-02
status: done
---

# 005: Addressed File Queueを実装する

## Goal

外部Messageを宛先別にat-least-onceで配送し、停止やcrashから回復可能にする。

## Scope

- 宛先別spoolと安全なdestination encode
- Envelope validation、temp write、atomic rename、claim、ack
- retry / backoff、lease recovery、dead-letter、subscription lifecycle

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-05
- `docs/ARCHITECTURE.md` 5.2、7章
- `docs/TEST_STRATEGY.md` 8.1、9.4

## Acceptance criteria

- [ ] 指定destinationのconsumerだけへ配送する
- [ ] 同じMessageを複数consumerが同時claimしない
- [ ] handler失敗、lease切れ、process再起動から再配送できる
- [ ] attempt上限と不正Envelopeをdead-letterへ移す
- [ ] Queue固有のack / nackをApplicationへ漏らさない

## Tests

- 共通MessageQueue contract
- 複数publisher / consumer、途中file、不正JSON、重複ID、root escape、crash recovery

## Dependencies

- 002
- 003
