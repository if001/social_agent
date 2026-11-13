---
created_at: 2026-11-13
status: done
type: feature
plan: []
requirements: [FR-41, FR-42, FR-57, FR-58, FR-60, FR-71, NFR-7, NFR-8]
requires: agent
---

# 027 16 Event単位のMemory Formationを実装する

元計画：[Issue 026](026-design-memory-formation-and-reconciliation.md) で確定するA/B設計。

## Background

未統合Eventから新しい経験を形成する処理を、既存Memoryの全件比較・更新から分離する。現行の32 Event Memory batchは既存Memory最大32件を毎回全文入力し、token超過と古いEventによる新しいMemory更新を招いている。

## Dependencies

- 026（A/B設計と要件・用語・Event検索方針の確定）

## Scope

- 固定Reflection Event範囲を古い順に最大16 EventのFormation batchへ分割する。
- Formation Reflectorは新規Memory候補と直接根拠Eventだけを選び、既存Memory本文を初期入力へ含めない。
- 必要な重複確認は小さな読み取りToolで行い、古いEventが新しいMemoryを更新しないMemoryWriteService経路を実装する。
- batchの入力、出力、Tool実行、create / no-op、retryを監査する。
- 既存32 Event Memory batch実装を置換または安全に移行する。

## Out of scope

- 既存Memoryを起点とした補強・訂正・分割・維持（Issue 028）。
- Background Experienceの更新。

## Acceptance criteria

- [x] FR-71：16 Event以下のFormation batchが未統合Eventから再利用可能な新規Memoryだけを形成する。初期モデル入力は既存Memory全件を含まず、入力budget超過で停止しない。古いEventを根拠にしたFormationは、新しい既存Memoryを内容一致だけで更新しない。
- [x] FR-42, FR-57, FR-58, FR-60, NFR-7, NFR-8：structured output repair、MemoryWriteService、冪等性、batch retry、監査を維持する。

## 実装メモ

- `ReflectionMemoryBatch`と永続batchを最大16 Eventへ変更した。64 Eventは4 batchとして古い順に処理し、完了batchは再実行しない。
- Formationのモデル入力は`reflectionId`と対象Eventだけであり、既存Memory本文を含めない。重複候補の更新も許可せず、`formation: true`のMemoryUpdateHandlerは空候補をMemoryWriteServiceへ渡す。
- 検証：`pnpm typecheck`、`pnpm lint`、`pnpm test`（213 passed）。
- レビュー：[`2026-11-13-issue-027.md`](../docs/work/reviews/2026-11-13-issue-027.md)。

## Tests

- 追加：17 / 32 / 64 Eventが16 Event batchへ古い順に分割され、完了batchを再実行しない。
- 追加：大きな既存Memory集合があってもFormation初期入力がboundedである。
- 追加：古いEventと新しい類似Memoryが共存しても、Formationが新しいMemoryを更新しない。
- FR-42, FR-57, FR-58, NFR-7, NFR-8：repair、MemoryWriteService、失敗batch retry、監査の回帰。
