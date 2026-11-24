---
created_at: 2026-11-24
status: created
type: change
plan: []
requirements: [FR-24, FR-39, NFR-6]
ui: []
requires: agent
---

# 078 Concernごとの時刻scheduleをcoalesced signalへ置換する

元設計：[#077](077-redesign-concern-due-as-motivational-reevaluation.md)

## Background

Concernの`reconsider_at`と個別`concern-due` scheduleは、持続的動機を期限付きTaskとして実行してしまう。FR-24は新しいMemory又はexternal-changeからAgent単位でcoalesceするsignalを要求する。

## Dependencies

- #077 done

## Scope

- `concerns.reconsider_at`、Concern単位のschedule同期、成功後の翌日再予約をschema・repository・schedulerから除去する。
- Agent単位の`concern-due` signalを永続化し、claim / lease / retry / 再起動復元を実装する。
- Memory writeとexternal-changeがsignalをupsertする経路を追加する。
- 既存の`reconsider_at`値とConcern scheduleを削除するDrizzle migrationとdry-run既定のdata migrationを作る。

## Out of scope

- 候補Concernの検索とlifecycle判断（#079）
- ReflectionのConcern整理（#081）

## Acceptance criteria

- [ ] AC-078-1：Concernごとの`reconsider_at`とscheduleがschema・writer・readerから除去される。
- [ ] AC-078-2：同一Agentへの複数triggerが一つの未完signalへcoalesceされる。
- [ ] AC-078-3：成功したsignalは自動再予約されず、失敗時だけsignal単位でretryされる。
- [ ] AC-078-4：既存Concern schedule / `reconsider_at`を安全に除去できるmigrationがある。

## Tests

- FR-24：同一Agentの複数Memory更新が一つのsignalになる。
- FR-24, NFR-6：signalの成功後に翌日scheduleが作られず、retryは失敗時だけ行われる。
- FR-39：再起動後に未完signalだけが再開する。
