---
created_at: 2026-10-03
status: done
---

# 031: 本番Context LoaderとAgent依存関係を構成する

## Goal

PostgreSQLの保存状態と現在Eventから実際のAgent Core入力を構築し、通常CoreとReview Coreへ到達する本番compositionを作る。

## Scope

- Agent／Family／Dynamic State／Social Context／Memory／IntentionをAgent単位で読み込む本番Context Loaderを実装する。
- Retrieval、Context budget、Tool定義、Runtime constraints、run limitsを入力へ反映する。
- Tool RegistryへWeb、File、`agent_send`を登録し、Deep Agent内部実行とTool trace保存へ接続する。
- `PostgresRuntimePersistence`、通常Harness、Long-term Review Service、Agent Event Routerを構成するfactoryを実装する。
- 他Agentの状態やMemoryが混入しないことを検証する。

## Acceptance criteria

- [x] 実DBのAgent状態から`AgentCoreInput`を構築できる。
- [x] 通常Eventが通常Core、Review EventがReview Coreへ到達する。
- [x] Tool実行記録と提案が既存transactionへ保存される。
- [x] 2 AgentのContextが分離される。

## Implementation notes

- PostgreSQLのAgent、Family、Dynamic State、Social Context、Memory、Intentionから`AgentCoreInput`を構築する本番Loaderを追加した。
- Observationを検索queryとしてEmbeddingを生成し、Agent IDで分離したMemory retrievalとContext budgetを適用する。
- Web、File、`agent_send`を登録したTool Registry、通常Core、Runtime persistence、Review Core、Event Router、Outboxをproduction compositionで結線した。
- 受信Envelopeのhop、TTL、reply先をrun transportとしてTool実行へ渡し、`agent_send`の循環制限と返信経路を維持する。

## Tests

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`（62件）
- `.env`の`POSTGRES_URL`を使用した`pnpm test:integration`（11件）
- `pnpm test:system`（13件）


## Dependencies

- 030
