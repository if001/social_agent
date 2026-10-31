---
created_at: 2026-10-29
status: doing
type: change
plan: []
requirements: [C-64, C-68, FR-60, NFR-17, AC-15]
requires: agent
---

# 015 Reflectionの部分成功とmemory-update連携を実装する

元計画：なし（[012](012-memory-write-service.md)、[013](013-memory-update-event.md)の後続）

## Background

現在のReflectionはstateとMemoryを一つのDB transactionでcommitする。設計では、ReflectionはMemory、Self、Relationship、Concernごとのstatusを持つplanで適用し、Memory更新はmemory-update Eventで先に行い、その結果を根拠にSelf、Relationship、Concernを更新する。失敗またはblockedの対象だけを次回再試行する。

## Dependencies

- 012
- 013

## Scope

- Reflection planと対象別status（pending、completed、failed、blocked）を追加する。
- ReflectionのMemoryIntentをmemory-update Eventへ渡す。
- Memory更新後にSelf、Relationship、Concernを更新する。
- 失敗またはblockedの対象だけを次回Reflectionで再試行する。
- 部分成功を監査とDebug UIで識別できるようにする。
- 既存の直接Memory INSERTをMemoryWriteServiceへ移行する。
- 既存の指数backoffと入力上限を維持する。

## Out of scope

- G3の実装（014）。
- Reflectionの入力上限やbackoff値の変更。
- Background Experienceの更新。

## Implementation notes

- 同一DB transactionを必須にしない。
- Memory更新が失敗した場合、依存するSelf、Relationship、Concernをblockedにする。
- Self変更にはConversation Memory根拠と理由を必須とする。
- ReflectionのMemory、Self、Relationship、Concernのstatusをreflection_runsに保持する。
- 部分成功を失敗扱いにせず、次回再試行の対象にする。

## Acceptance criteria

- [ ] AC-15：Reflectionが対象別statusを持ち、失敗対象だけを再試行する。
- [ ] Memory更新はmemory-update Eventで先に適用される。
- [ ] Memory更新失敗時に依存対象がblockedになる。
- [ ] Self変更にConversation Memory根拠と理由がある。
- [ ] 部分成功が監査とDebug UIで識別できる。

## Tests

- FR-60：`tests/system/reflection-partial.test.ts`でstatus、blocked、再試行を検証する。
- FR-60, NFR-17：`tests/integration/persistence.test.ts`でreflection plan、対象別status、Memory更新との連携を検証する。
- AC-15：上記のtestを通す。

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| src/application/reflection.ts | plan/status、MemoryIntent | 更新する |
| src/infrastructure/persistence/postgres-reflection.ts | 部分成功、MemoryWriteService連携 | 更新する |
| src/infrastructure/persistence/schema.ts | reflection_runsのplan/status | 更新する |
| src/application/scheduler.ts | Reflectionの再試行 | 更新する |
| src/debug-ui | 部分成功の表示 | 更新する |
| tests/system, tests/integration | 追加設計のtest | 追加する |

## 実装メモ（WIP）

- ReflectionPlanSchemaと`reflection_runs.plan`を追加した。
- Memory更新はmemory-update sink利用時にpending、直接更新時はcompletedとして記録する。
- 未実装：対象別のfailed/blocked、Memory更新失敗時の依存blocked、失敗対象だけの再試行、Debug UI表示。
- このため`status: doing`のままにし、mainへマージしない。
