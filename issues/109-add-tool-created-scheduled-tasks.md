---
created_at: 2026-10-10
status: created
---

# 109: Toolで作成するScheduled Taskを実装する

## Background

Intentionから予約実行と約束の責務を分離するため、明示的な将来処理をToolで作成し、RuntimeとSchedulerが確実に実行する仕組みが必要である。Scheduled Taskは動機や感情ではなく、実行時刻、処理内容、配送先、実行状態を持つ運用エンティティとする。

## Dependencies

- Issue 107
- Issue 108

## Scope

- `scheduled_tasks`のDomain ContractとDrizzle Schemaを追加する
- one-shotの`executeAt`、Timezone解決済み時刻、instruction、reason、destination、status、attempt、source Event / Runを保存する
- `schedule_task` Toolを追加する
- `scheduled_task_list` Toolを追加する
- `scheduled_task_cancel` Toolを追加する
- Toolの所有Agent検証、入力検証、idempotencyを実装する
- Schedulerがdue Taskをleaseし、`targetKind=scheduled-task` Eventを生成する
- Task Event完了時にcompleted、失敗時にbackoffまたはfailedへ遷移させる
- 外部配送は既存Outboxを利用する
- Task作成・完了・取消をEpisodic Memoryへ提案できるようにする
- Debug UIへScheduled Task一覧と状態を表示する
- Drizzle migrationを生成する

## Out of scope

- recurring schedule / cron
- 曖昧な時刻文字列のままの保存
- Calendar連携
- Scheduled TaskへMood、Drive、Current Interestを複製すること
- Intention削除。Issue 110で行う

## Implementation notes

- 初期実装は一回限りのTaskとする。
- `executeAt`はTool呼び出し前に具体的なInstantへ解決し、曖昧ならユーザーへ確認する。
- TaskはTool実行でのみ作成し、Post-process LLMから直接生成しない。
- 「約束した」という意味はMemoryへ保存し、Schedulerの正本は`scheduled_tasks`とする。
- 配送失敗とAgent実行失敗を区別する。

## Acceptance criteria

- AgentがToolを使って指定時刻のTaskを作成できる
- due Taskが一度だけclaimされ、System/Internal Eventとして実行される
- 完了、失敗、取消を追跡できる
- Agent AのTaskをAgent Bが変更できない
- Task作成が再試行されても重複しない
- 心理状態とScheduled Taskが別のContext / DB領域に保存される

## Tests

- Scheduled Task Domain Contract test
- Tool create / list / cancel test
- ownership / idempotency test
- due / lease / retry Scheduler test
- Outbox delivery system test
- Debug UI test
- Drizzle migration integration test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:system`
- DB integration test

## References

- [Issue 107](./107-document-motivation-and-scheduled-task-model.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
