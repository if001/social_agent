---
created_at: 2026-10-03
status: created
---

# 032: Bot Hostの常駐loopとgraceful shutdownを実装する

## Goal

1 process内でRuntime、Scheduler、Outbox、UI Adapterを起動し、安全に停止・再開できるBot Hostを実装する。

## Scope

- 起動時にDB、Chat Ollama、Embedding Ollama、Agent存在、同一Agent lockを確認する。
- Runtime consumer、Scheduler tick、Outbox Dispatcher、Discord inbound／outboundを開始する。
- 各loopの間隔、backoff、失敗時のdegraded／fatal判定を実装する。
- SIGINT／SIGTERMで新規受付を止め、処理中runをdrainし、lease／DB／Discord接続を解放する。
- process crash後にQueue、Outbox、Schedule Candidateを再取得する。

## Acceptance criteria

- [ ] `bot:start`から全componentが到達可能になる。
- [ ] 同一Agentの二重process起動を拒否する。
- [ ] 一時的なDiscord／Web障害で復旧可能な処理を失わない。
- [ ] graceful shutdown後に未完了処理を再起動で回収できる。

## Dependencies

- 031

