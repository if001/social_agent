---
created_at: 2026-11-25
status: done
type: fix
plan: []
requirements: [FR-82, NFR-8]
ui: []
requires: agent
---

# 092 旧Experience Integration出力を復元し、現行出力契約を明示する

## Background

Experience Integration の pending / failed Integration を再開する際、既存 `agent_runs.result` に保存された旧出力形と現行 strict schema の不一致が表面化した。Git履歴では、旧設計の Relationship は `upsert.relationship.{subjectId,description}` / `remove.subjectId` で対象を LLM 出力に含めていた。現在は対象を Runtime が所有する。

一方、Event Experience は追跡可能な履歴上も `summary` / `facts` のみであり、`experience.occurredAt` / `kind` と `relationship.target` は過去の正式 schema に存在しなかった。これは現行 LLM が Event 入力の監査情報または一般化した対象名を誤って出力へ混入している。repair 後も残ると、FR-82 の strict schema により Integration が失敗する。

## Dependencies

- Issue 091（done）

## Scope

- 現行 prompt と repair 指示に、`experience` と `relationship` の許可フィールド・Runtime 所有フィールドを明記する。
- 旧出力形、現行の不正出力、repair 後の正規出力を区別する回帰テストを追加する。

## Out of scope

- 現行 `ExperienceIntegrationOutputSchema` の strict 性を緩めること。
- `agent_runs` や `experience_integrations` の履歴 JSON を書き換える migration。
- Runtime が所有する対象・Event 時刻・kind を LLM 出力へ戻すこと。

## Acceptance criteria

- [x] FR-82：prompt / repair は `experience` が `summary` / `facts` のみ、Relationship が `operation` / `currentDescription` / `description` / `reason` のみであることを明示する。
- [x] NFR-8：現行の未認識フィールドは strict schema で拒否し、偽 Model の一回の repair により正規出力へ収束する。

## Tests

- FR-82, NFR-8：`occurredAt`、`kind`、`target` を含む不正出力が repair 後に一度だけ apply される unit test。
- FR-82：prompt / repair instruction の許可フィールド・Runtime 所有フィールドを検証する unit test。

## 上流への反映

- 不要。FR-82 / NFR-8 の既存契約に対する履歴復元・prompt・test の実装修正である。

## 実装メモ

- Git履歴を確認した結果、過去の正式 Experience Integration schema は Event Experience に `occurredAt` / `kind` を持たず、Relationship は `upsert.relationship.{subjectId,description}` / `remove.subjectId` だった。今回の `relationship.target` も含め、報告された余分fieldは旧JSONを復元したものではない。
- pending / failed Integration は `agent_runs.result` を Agent Core 結果として復元した後、Experience Integration Model を再実行する。過去の `experience_integrations.output` は再入力されないため、存在しない旧形を復元互換として受理する変更は行わない。
- system prompt とrepair指示へ、Event ExperienceとRelationshipの許可field、およびRuntimeが所有する監査・対象fieldを明記した。
- 検証：`pnpm test -- tests/unit/experience-integration.test.ts`（300件）、`pnpm typecheck`、`pnpm lint`、`python3 .agents/skills/spec-analyze/scripts/trace_check.py --root .`（ERROR 0、既存WARN 8）。
- レビュー：`docs/work/reviews/2026-11-25-issue-092.md`。
