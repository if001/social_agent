---
created_at: 2026-10-04
status: done
---

# 052: 他Agent由来MemoryのprovenanceをRuntimeで検証する

## Background

概念設計 §13と実装設計 §28では「自分の経験」と「他Agentから聞いた情報」を区別する。現状はLLMがEpisodic Memory Proposalの任意の`sourceAgentId`を自由に設定でき、Runtimeは今回のObservationのactor/sender/provenanceと一致するか検証せず保存する（`MemoryProposalSchema`、`PostgresRuntimePersistence.#materialize`）。誤った直接経験または送信元を永続化できる。

## Scope

- 概念設計と実装設計を一次情報としてdocsの契約を整合させる。
- Domain、Runtime、PersistenceまたはAdapterの必要箇所を修正する。
- 不要になった旧契約と後方互換処理を削除し、必要なmigrationを適用する。

## Out of scope

- この項目と無関係な振る舞いの変更。
- 数ターンの自動テストによる長期人格形成の合否判定。

## Implementation notes

- 対応ブランチ: `checklist/runtime-memory-provenance`
- LLMは自然言語の意味判断と提案を担当し、RuntimeはID、時刻、所有権、権限、参照整合性を検証する。
- 既存データ構造を変更する項目では、冪等なPostgreSQL migrationで現行形式へ統一する。

## Acceptance criteria

- [x] specとdocsの責務・データ契約が整合している。
- [x] 対応ブランチの実装がmainへマージされている。
- [x] 廃止した契約や列を残していない。
- [x] Agent所有権と根拠provenanceを維持している。

## Tests

- TypeScript typecheckとESLint。
- 関連するunit／contract／system test。
- PostgreSQLを使用する変更は、実行時`.env`を読み込むintegration test。

## Plan reference

- [Concept gap checklist](../note/concept-design-implementation-gaps.md)
- [Concept Design](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation Design](../spec/personal-agent-implementation-design-v2.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)

