---
created_at: 2026-10-24
status: done
type: change
plan: []
requirements: [FR-40]
requires: agent
---

# 007 Scheduled Task instruction の責務を明確化する

起点：2026-10-24 の会話で、Scheduled Task の `instruction` が長文化しているため、Tool description と各入力fieldの責務を明確にする方針が承認された。

## Background

`schedule_task` の `instruction` は現在「実行時にAgentへ渡す具体的な指示」とだけ説明され、`executeAt`、`reason`、`destination` や共通の実行規則との境界が明示されていない。そのため、期限到来時の仕事以外の情報まで `instruction` に重複して記述できる。

## Dependencies

なし。

## Scope

- FR-40 に、Scheduled Task の各fieldの責務と `instruction` の記述範囲を追加する。
- Architecture に、Tool schemaとscheduled-task skillの責務分担を追加する。
- `schedule_task` と `scheduled_task_update` のschema descriptionを具体化する。
- `instruction` の最大長を4,000文字から1,000文字へ変更する。
- Tool Registryが公開するJSON Schemaを通じてdescriptionと文字数制約を検証する。

## Out of scope

- Scheduled Taskの永続化、claim、lease、retry、配送処理の変更。
- `instruction` の自動要約や既存DBデータの移行。
- 一次文書 `spec/` の変更。
- scheduled-task skillの実行規則の変更。

## Implementation notes

- Tool descriptionはToolを選択する条件だけを書く。
- field descriptionは、値へ記述する内容と記述しない内容を示す。
- `instruction` は期限到来時の仕事だけを1〜2文で記述し、必要な場合だけ対象、参照情報、期待結果を含める。
- 日時は `executeAt`、予約理由は `reason`、配送先は `destination` に分離する。
- Tool選択、失敗通知、内部情報の非開示などの共通動作規則は `instruction` に複製しない。

## Acceptance criteria

- [x] AC-007-1：Scheduled Taskの4入力fieldの責務が正の文書で区別されている。
- [x] AC-007-2：`instruction` のschema descriptionが、含める内容と含めない内容を示している。
- [x] AC-007-3：作成と更新の `instruction` は1,000文字を超える入力を拒否する。
- [x] AC-007-4：Tool description、field description、scheduled-task skillに同じ実行規則を重複させない。
- [x] AC-007-5：差分が正の文書に反映されている。
- [x] AC-007-6：上流への反映がすべて「反映済み」または「不要」になっている。
- [x] AC-007-7：`spec-analyze change` でCRITICALとHIGHの指摘がない。

## Tests

- FR-40：`ToolRegistry.definitions()` がScheduled Taskの用途と各入力fieldの責務を区別したJSON Schemaを返す。
- FR-40：`schedule_task` が1,000文字のinstructionを受理し、1,001文字を拒否する。
- FR-40：`scheduled_task_update` が1,001文字のinstructionを拒否する。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-40 | Scheduled Taskの各fieldとinstructionの記述責務を明確にする | docs/REQUIREMENTS.md |
| MODIFIED | ADR-7 | Tool schema、skill、Scheduled Task fieldの責務分担を明確にする | docs/ARCHITECTURE.md |

## 影響範囲

検索した語：FR-40、Scheduled Task、`schedule_task`、`instruction`、`reason`、`destination`

| 場所 | 内容 | 対応 |
|---|---|---|
| docs/REQUIREMENTS.md R7 | FR-40のScheduled Task要件 | field責務を追記する |
| docs/ARCHITECTURE.md Event-driven autonomyとReflection | SchedulerとScheduled Taskの設計 | Tool schemaとskillの責務分担を追記する |
| src/infrastructure/tools/scheduled-task-tools.ts | Toolと入力schemaのdescription、文字数制約 | 更新する |
| tests/unit/scheduled-task-tools.test.ts | Scheduled Task Toolの公開動作 | schema定義と上限のテストを追加する |
| skills/scheduled-task/SKILL.md | 期限到来後の実行規則 | 変更しない。予約時のfield記述規則を重複させないため |
| src/application/scheduler.ts | instructionをSystem Eventへ渡す処理 | 変更しない。field内容の契約変更であり伝播処理は変わらないため |
| src/infrastructure/persistence/postgres-schedule-repository.ts | instructionの保存と取得 | 変更しない。DB型と取得処理は変わらないため |
| spec/personal-agent-concept-design-restructured-v2.md C-08 | Scheduled Taskの概念 | 変更しない。既存の責務分離を具体化する下流変更のため |
| spec/personal-agent-implementation-design-v2.md §14 | Scheduled Taskの実装設計 | 変更しない。正のdocsでfield入力契約を具体化するため |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md C-08 | 既存のScheduled Task責務を変更しない | 不要 |
| spec/personal-agent-implementation-design-v2.md §14 | 型と実行経路を変更しない | 不要 |

## 実装メモ

- `instruction` の上限は正の要件と作成・更新schemaで1,000文字に統一した。
- Tool descriptionは用途、field descriptionは保存内容、scheduled-task skillは期限到来後の実行規則に分離した。
- `ToolRegistry.definitions()` と `ToolRegistry.execute()` を公開テスト境界として、description、JSON Schema、作成・更新の上限を検証した。
- 検証：typecheck、lint、unit/contract 158件、integration 26件、system 43件、evaluation 14件が成功した。
- ID検査：ERROR 0件、WARN 0件。既存のINFO 4件はIssue 007対象外。
- spec-analyze change：CRITICAL 0件、HIGH 0件、MEDIUM 0件、LOW 0件。
- 分析記録：`docs/work/analyze/2026-10-24-change.md`。
- レビュー記録：`docs/work/reviews/2026-10-24-issue-007.md`（PASS、指摘なし）。
