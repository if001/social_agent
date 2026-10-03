---
created_at: 2026-10-03
status: done
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

- [x] `bot:start`から全componentが到達可能になる。
- [x] 同一Agentの二重process起動を拒否する。
- [x] 一時的なDiscord／Web障害で復旧可能な処理を失わない。
- [x] graceful shutdown後に未完了処理を再起動で回収できる。

## Dependencies

- 031

## Implementation notes

- DB、対象Agent、Chat Ollama、Embedding Ollamaを検査してからreadyへ遷移するBot Hostを追加した。
- Agent ID由来のPostgreSQL advisory lockを専用connectionで保持し、同一Agentの二重起動を拒否する。
- Runtime、Scheduler、Outbox、Discord inbound／outboundを常駐loopとして起動し、一時失敗時はdegradedへ遷移して再試行する。
- SIGINT／SIGTERMで受付を中断し、loop停止、Runtime drain、lock解放、DB切断を順に実行する。
- Schedulerのclaimをprocessが所有するAgent IDに限定した。

## Tests

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`（62件）
- `.env`の`POSTGRES_URL`を使用した`pnpm test:integration`（12件）
- `pnpm test:system`（13件）
