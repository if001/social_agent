---
created_at: 2026-10-29
status: doing
type: feature
plan: []
requirements: [C-59, C-60, C-61, C-66, C-69, FR-58, FR-59, FR-61, NFR-17, NFR-18, AC-13]
requires: agent
---

# 013 memory-update EventとMemoryUpdateHandlerを実装する

元計画：なし（[011](011-g1g2-prediction-loop.md)、[012](012-memory-write-service.md)の後続）

## Background

G1/G2/ReflectionのMemoryIntentは、決定済みの更新計画としてmemory-update Eventで適用する。memory-updateはLLMを呼ばず、MemoryUpdateHandlerがMemoryWriteServiceを通してcreate、update、no-opを適用する。user-message、memory-update、G3、reflectionの優先順位と、user-messageを待たせない協調制御が必要である。

## Dependencies

- 011
- 012

## Scope

- `memory-update` internal Eventとpayloadを追加する。
- `MemoryUpdateHandler`を追加し、LLMを呼ばずにMemoryIntentを適用する。
- G1/G2/ReflectionのMemoryIntentをmemory-update Eventへ登録する。
- G3のMemoryIntentはMainAgentの再判断後に登録する。
- sourceEventIdとintentIndexの冪等性を実装する。
- Event単位のtransactionと部分commit禁止を実装する。
- Event優先順位user-message、memory-update、G3、reflectionを実装する。
- user-message優先の協調的スケジューリングを実装する。
- 失敗時に応答やOutboxを巻き戻さない。

## Out of scope

- G3 DeepAgent（014）。
- Reflectionの部分成功（015）。
- G1/G2の予測call自体（011）。

## Implementation notes

- MemoryUpdateHandlerはAgentHarnessを実行しない。
- user-messageが待っている間はmemory-updateを開始しない。
- 実行中でも強制中断せず、短いtransaction単位で完了させる。
- 古い候補は同じqueryで再検索するかno-opにする。
- memory-update EventはActionを生成しない。
- MemoryUpdate Eventのpayloadと監査は`memory_mutations`に保存する。

## Acceptance criteria

- [ ] AC-13：memory-update EventがLLMを呼ばず、専用Handler、冪等性、部分commit禁止、user-message優先で動く。
- [ ] G1/G2/ReflectionのMemoryIntentがmemory-update Eventで適用される。
- [ ] G3のMemoryIntentはMainAgentの再判断後に適用される。
- [ ] user-messageがmemory-updateで待たされない。
- [ ] 失敗時に元の応答やOutboxが巻き戻らない。

## Tests

- FR-58, FR-59：`tests/system/memory-update-event.test.ts`で専用Handler、LLM非呼出、優先順位を検証する。
- FR-61, NFR-17：`tests/system/memory-update-event.test.ts`と`tests/integration/persistence.test.ts`でintentIndex冪等性、部分commit禁止、監査を検証する。
- NFR-18：`tests/system/memory-update-event.test.ts`でuser-message優先と開始抑制を検証する。
- AC-13：上記のtestを通す。

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| src/domain/contracts.ts | memory-update Event payload | 追加する |
| src/application/memory-update.ts | MemoryUpdateHandler | 追加する |
| src/application/agent-runtime.ts | Event priorityとuser-message優先 | 更新する |
| src/application/scheduler.ts | memory-updateの扱い | 更新する |
| src/infrastructure/persistence/event-transaction.ts | memory-update Eventの保存 | 更新する |
| src/infrastructure/persistence/schema.ts | memory_mutations | 追加する |
| src/bootstrap/bot-composition.ts | Handlerの配線 | 更新する |
| tests/system, tests/integration | 追加設計のtest | 追加する |

## 実装メモ（WIP）

- MemoryUpdatePayloadSchemaとMemoryUpdateHandlerを追加した。
- AgentRuntimeは`targetKind: memory-update`のEventをHandlerへ渡し、AgentHarnessを実行しない。
- Handlerは1 transactionでMemoryWriteServiceを適用し、失敗時は全体をrollbackする。
- 未実装：G1/G2/ReflectionからのEvent登録、Event優先順位とuser-message優先の協調制御。
- このため`status: doing`のままにし、mainへマージしない。
