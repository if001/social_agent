---
created_at: 2026-11-24
status: done
type: change
plan: []
requirements: [FR-24, FR-39, NFR-6]
ui: []
requires: agent
---

# 078 Concernごとの時刻scheduleをcoalesced signalへ置換する

元設計：[#077](077-redesign-concern-due-as-motivational-reevaluation.md)

## Background

Concernの`reconsider_at`と個別`concern-due` scheduleは、持続的動機を期限付きTaskとして実行してしまう。FR-24は新しいMemoryからAgent単位でcoalesceするsignalを要求する。

## Dependencies

- #077 done

## Scope

- `concerns.reconsider_at`、Concern単位のschedule同期、成功後の翌日再予約をschema・repository・schedulerから除去する。
- Agent単位の`concern-due` signalを永続化し、claim / lease / retry / 再起動復元を実装する。
- Memory writeがsignalをupsertする経路を追加する。定期schedulerの`external-change`は具体的な外部入力を持たない再評価Eventだったため、契約・実装・文書から除去する。
- 既存の`reconsider_at`値とConcern scheduleを削除するDrizzle migrationとdry-run既定のdata migrationを作る。

## Out of scope

- 候補Concernの検索とlifecycle判断（#079）
- ReflectionのConcern整理（#081）

## Acceptance criteria

- [x] AC-078-1：Concernごとの`reconsider_at`とscheduleがschema・writer・readerから除去される。
- [x] AC-078-2：同一Agentへの複数triggerが一つの未完signalへcoalesceされる。
- [x] AC-078-3：成功したsignalは自動再予約されず、失敗時だけsignal単位でretryされる。
- [x] AC-078-4：既存Concern schedule / `reconsider_at`を安全に除去できるmigrationがある。
- [x] AC-078-5：`external-change`はscheduler target、signal source、Agent Core routeから除去され、既存scheduleだけをdata migrationで削除できる。

## Tests

- FR-24：同一Agentの複数Memory更新が一つのsignalになる。
- FR-24, NFR-6：signalの成功後に翌日scheduleが作られず、retryは失敗時だけ行われる。
- FR-39：再起動後に未完signalだけが再開する。

## 設計決定

定期schedulerの`external-change`は具体的な外部入力を持たず、Memory / Eventを再解釈するだけの重複した通常Loopだったため廃止する。Concern派生の契機は実際に保存された新しいMemoryだけとし、派生検討は`concern-due`へ一意に集約する。

## 実装メモ

- `concern_reevaluation_signals` は Agent ごとに一行だけ保持し、`concern_reevaluation_signal_sources` に Memory 根拠を重複なく保持する。
- claim 中に新しい根拠が入った場合は、更新時刻の世代照合で signal を消さず、lease を解除して次 tick へ渡す。
- `pnpm concern:signals:migrate` は dry-run が既定で、`--apply` 指定時だけ旧 `concern-due` / `external-change` schedule を削除する。Drizzle migration 0049 は `reconsider_at` と新しい table を管理する。
- 検証: `pnpm run typecheck`、`pnpm run lint`、関連 unit 43件、実DB integration 54件。`trace_check` は ERROR 0件、既存の WARN 8件。

## 完了メモ

- 正の文書は、Concern派生の契機を保存済みMemoryだけへ統一し、`external-change` をEvent source・Scheduler target・発話経路から削除した。
- migration scriptは旧`concern-due`と`external-change` scheduleをdry-runで数え、`--apply`時だけ削除する。
- 検証: `pnpm run db:generate`、`pnpm run typecheck`、`pnpm run lint`、`pnpm run test`、テストDB migration、Persistence integration 52件、`trace_check`（ERROR 0）。
- レビュー: `docs/work/reviews/2026-11-24-issue-078.md`。
