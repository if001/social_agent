---
created_at: 2026-10-02
status: done
---

# 014: Discord Adapterを実装する

## Goal

Discordを共通Queue契約へ接続し、Terminalと同じAgent状態を利用する。

## Scope

- Discord gateway adapter
- owner / guild / channel allowlist
- 安定Message ID、channel / threadを含む`replyTo`
- outbound、rate limit、reconnect、retry、delivery mapping

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-14
- `docs/ARCHITECTURE.md` 5.3、13、16章
- `docs/TEST_STRATEGY.md` 8.4、ST-02
- `.env.sample`

## Acceptance criteria

- [ ] allowlist外入力をAgentへ渡さない
- [ ] 同じDiscord Messageを重複publishしない
- [ ] channel / threadへ正しく返信する
- [ ] outbound失敗時にQueueをackせず、再接続後に配送する
- [ ] TerminalとDiscordが同じAgentの永続状態を参照する

## Tests

- Fake Discord Gatewayを使うUI Adapter contract
- ST-02 allowlist、重複、thread、retry
- 実DiscordはManual Smokeで確認

## Dependencies

- 005
- 009
