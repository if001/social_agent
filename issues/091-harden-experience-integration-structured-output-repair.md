---
created_at: 2026-11-25
status: done
type: fix
plan: []
requirements: [FR-82, FR-95, NFR-8]
ui: []
requires: agent
---

# 091 Experience Integrationの構造出力とrepairを強化する

## Background

Experience Integrationの新規LLM出力が、旧`concernStatus`、Relationshipの不正operation、`reason`欠落を含みschema validationで失敗した。FR-82のschemaとfield descriptionは存在し、Application層のone-shot repairも実装済みだが、system promptはこの機械契約を明示せず、テストはMemory候補のrepairだけを検証していた。

## Scope

- Experience Integration system promptとrepair指示に、Relationshipの`upsert | remove`、reason必須、root `concernStatus`禁止、Focus Concernの専用fieldを明示する。
- 不正Relationship / 旧`concernStatus`を返したmodelがrepair後に現行出力へ収束し、applyされるunit testを追加する。
- strict schemaが旧fieldを直接受理しないことを明示するtestを追加する。

## Out of scope

- Experience Integration schemaの緩和、旧`concernStatus`の互換受理。
- 実DBの履歴Run互換（Issue 087〜090）。
- LLM providerのJSON schema強制方式の変更。

## Acceptance criteria

- [x] FR-82：prompt / repairがRelationship operation、reason、現在状態の境界を明示する。`tests/unit/experience-integration.test.ts`。
- [x] FR-95：Focus Concern以外のConcern statusを出力しないことを明示する。`tests/unit/experience-integration.test.ts`。
- [x] NFR-8：旧`concernStatus`、不正operation、reason欠落はstrict schemaで拒否される。`tests/unit/experience-integration.test.ts`。
- [x] FR-82, NFR-8：不正出力がrepair後の有効な構造出力へ収束し、一度だけapplyされる。`tests/unit/experience-integration.test.ts`。

## Tests

- FR-82, FR-95：system promptとrepair入力の契約test。
- NFR-8：不正Relationship / 旧Concern fieldのschema rejection test。
- FR-82, NFR-8：偽Experience Integration Modelによる不正出力→repair→applyのunit test。

## 上流への反映

- 不要。FR-82 / FR-95 / NFR-8の既存契約をprompt、repair、テストへ完全に反映する実装修正である。

## 実装メモ

- system promptとrepair instructionへ、Relationshipの`upsert | remove`、reason必須、root `concernStatus`禁止、Focus Concern専用出力を明示した。
- 不正出力→validation issues→repair→applyのunit testを追加した。実LLM live testは現行生成経路のprovider接続を検証するもので、旧・不正JSONの網羅は決定論的な偽Model testで担保する。
- 検証：`pnpm test`（298件）、`pnpm typecheck`、`pnpm lint`、ID trace check（ERROR 0、既存WARN 8）。
- レビュー：`docs/work/reviews/2026-11-25-issue-091.md`。要件・受入条件に関わる未解決指摘なし。
