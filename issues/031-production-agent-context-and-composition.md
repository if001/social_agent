---
created_at: 2026-10-03
status: created
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

- [ ] 実DBのAgent状態から`AgentCoreInput`を構築できる。
- [ ] 通常Eventが通常Core、Review EventがReview Coreへ到達する。
- [ ] Tool実行記録と提案が既存transactionへ保存される。
- [ ] 2 AgentのContextが分離される。

## Dependencies

- 030

