---
created_at: 2026-10-02
status: created
---

# 009: Agent Runtimeの縦スライスとTerminal UIを実装する

## Goal

TerminalのUser Messageから状態確定と応答配送までのend-to-end経路を完成させる。

## Scope

- MessageからEvent / Observationへの変換とagent単位直列処理
- receipt、Context Builder、Harness、State Updateの調停
- outbox dispatcher、`replyTo`、Terminal Adapter、graceful drain

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-09
- `docs/ARCHITECTURE.md` 5.3、5.4、8.1、10.4
- `docs/TEST_STRATEGY.md` ST-01、ST-06

## Acceptance criteria

- [ ] Terminalから同じAgentへ継続対話できる
- [ ] 同一Messageで状態を二重更新しない
- [ ] DB commit後のcrashでも出力Messageを失わない
- [ ] LLM、DB、Queue失敗をretryまたはdead-letter可能な形で扱う
- [ ] SIGINT / SIGTERM時に新規受付を止め、処理中Messageを復旧可能にする

## Tests

- ST-01を最初のtracer bulletとして実装
- 重複入力、LLM失敗、DB失敗、publish失敗、停止位置別のsystem test

## Dependencies

- 002
- 003
- 004
- 005
- 006
- 007
- 008
