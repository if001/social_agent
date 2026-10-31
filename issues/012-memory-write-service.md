---
created_at: 2026-10-29
status: created
type: feature
plan: []
requirements: [C-49, C-55, C-57, C-58, C-63, C-67, FR-56, FR-57, NFR-15, AC-12, AC-17]
requires: agent
---

# 012 MemoryWriteServiceとMemoryIntentの書込み経路を実装する

元計画：なし（[009](009-background-experience-store-and-retrieval.md)、[011](011-g1g2-prediction-loop.md)の後続）

## Background

現在のMemory書込みは、AgentRuntimeの`remember`、Reflectionの直接INSERT、EventTransactionのINSERTに分かれている。Memoryは新規作成だけで、既存Memoryの更新経路がない。設計では、MemoryWriteServiceを唯一のDB gatewayとし、MemoryIntentとRAG候補からcreate、update、no-opを決め、Memory versionで競合を防ぐ。

## Dependencies

- 008
- 009

## Scope

- MemoryIntentのDomain型を追加する。
- MemoryWriteServiceを追加し、Agent所有権、origin、kind、subject、evidence、重複、文字数を検証する。
- RAG候補からcreate、update、no-opを決定する。
- `memories.version`を追加し、update時に楽観ロックする。
- Agent単位の直列処理を保証する。
- create/update/no-opの監査を`memory_mutations`へ記録する。
- MainAgentの`remember`を、そのEventのtransactionでMemoryWriteServiceへ移行する。
- AgentRuntime、EventTransaction、Reflectionの旧直接INSERTを削除する。
- Memory kindに`common-ground`を追加する。

## Out of scope

- memory-update EventとMemoryUpdateHandler（013）。
- G1/G2の予測Loop（011）。
- G3 DeepAgent（014）。
- Reflectionの部分成功（015）。

## Implementation notes

- MainAgentの`remember`は応答transactionに残す。G1/G2/G3/ReflectionのMemoryIntentは013のmemory-update Eventで適用する。
- MemoryIntentのtargetはepisodic、semantic、self-related、self-change、common-groundに限定する。
- RelationshipとConcernはMemoryWriteServiceで扱わず、既存Patch/Concern Proposalへ渡す。
- 誤ったMemory更新とno-opを許容する。
- `INSERT INTO memories`をMemoryWriteService以外に残さない。
- 既存ReflectionのMemory INSERTをMemoryWriteServiceへ置き換える。

## Acceptance criteria

- [ ] AC-12：create、update、no-op、Memory version競合、直接INSERT不在をIntegration testで確認する。
- [ ] AC-17：MemoryIntentのtargetにRelationshipとConcernが含まれず、既存Patch/Concern Proposalへ渡ることをContract testで確認する。
- [ ] MainAgentのrememberが応答transactionでMemoryWriteServiceを経由する。
- [ ] 既存の3つの直接INSERT経路が削除されている。
- [ ] version競合時に再検索、update、no-opのいずれかを選べる。

## Tests

- FR-57, NFR-15：`tests/unit/memory-write-service.test.ts`でcreate/update/no-op、version、冪等性を検証する。
- FR-56：`tests/unit/memory-intent.test.ts`でtarget限定とPatch/Concern経路を検証する。
- FR-57, NFR-15：`tests/integration/persistence.test.ts`でversion競合、memory mutation監査、直接INSERT不在を検証する。
- AC-12, AC-17：上記のtestを通す。

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| src/domain/contracts.ts | MemoryIntent、Memory version、common-ground | 追加する |
| src/application/memory-write-service.ts | 新規Service | 追加する |
| src/application/agent-state-patch.ts | rememberの受渡し | 更新する |
| src/infrastructure/persistence/postgres-runtime-persistence.ts | rememberの直接INSERT | MemoryWriteServiceへ移行する |
| src/infrastructure/persistence/event-transaction.ts | Memory INSERT | MemoryWriteServiceへ移行する |
| src/infrastructure/persistence/postgres-reflection.ts | Memory INSERT | MemoryWriteServiceへ移行する |
| src/infrastructure/persistence/schema.ts | memories.version、memory_mutations | 追加する |
| tests/unit, tests/integration | 追加設計のtest | 追加する |
