---
created_at: 2026-10-04
status: done
---

# 046: Desireの終了・失効・Event境界を実装する

## Background

概念設計 §10と実装設計 §4、§13ではDesireは基本的に短期で、継続する方針はIntentionへ昇格する。現状は `desires` を永続配列として保存し、LLMが明示的にremoveしない限り残り続ける。発生Event、生成時刻、失効条件も保持していない（`DynamicStateSchema`、`StateUpdateService`、`agent_states.desires`）。

## Scope

- 概念設計と実装設計を一次情報としてdocsの契約を整合させる。
- Domain、Runtime、PersistenceまたはAdapterの必要箇所を修正する。
- 不要になった旧契約と後方互換処理を削除し、必要なmigrationを適用する。

## Out of scope

- この項目と無関係な振る舞いの変更。
- 数ターンの自動テストによる長期人格形成の合否判定。

## Implementation notes

- 対応ブランチ: `checklist/short-term-emotion-desire`
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

