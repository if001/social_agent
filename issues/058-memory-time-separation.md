---
created_at: 2026-10-04
status: done
---

# 058: Memoryの出来事発生時刻と記録時刻を分離する

## Background

実装設計 §16は`occurredAt`と`createdAt`を区別する。現状のDomain `Memory.createdAt`にはDBの`occurred_at`を詰め、通常保存時もEvent時刻をoccurred_atとして使う一方、DBのcreated_atはDomainへ戻さない。後から過去の経験を記録した場合や伝聞の時系列を正確に扱えない（`MemorySchema`、`PostgresMemoryRetriever`、`PostgresRuntimePersistence.#materialize`）。

## Scope

- 概念設計と実装設計を一次情報としてdocsの契約を整合させる。
- Domain、Runtime、PersistenceまたはAdapterの必要箇所を修正する。
- 不要になった旧契約と後方互換処理を削除し、必要なmigrationを適用する。

## Out of scope

- この項目と無関係な振る舞いの変更。
- 数ターンの自動テストによる長期人格形成の合否判定。

## Implementation notes

- 対応ブランチ: `checklist/memory-time-separation`
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

