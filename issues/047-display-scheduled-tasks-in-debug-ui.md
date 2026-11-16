---
created_at: 2026-11-16
status: done
type: feature
plan: []
requirements: [NFR-12, FR-40]
ui: []
requires: agent
---

# 047 Debug UIでScheduled Taskを表示する

元計画：ユーザーからのDebug UI改善依頼

## Background

`scheduled_tasks` はDebug UIのOverview取得対象だが、画面上では通常表示されない。明示的な将来実行の予約を、通常の自律Scheduleと区別して観測できるようにする。

## Dependencies

- なし

## Scope

- Agent Overviewに「予約されたタスク」パネルを追加する。
- 予約日時、指示、理由、配送先、状態、試行回数、実行Event、失敗理由を確認できるようにする。
- 直近の予定・実行状況を簡潔に表示し、全取得項目は詳細で表示する。

## Out of scope

- Scheduled Taskの作成、取消、再実行などの書込み操作
- `autonomous_schedules` の意味やSchedulerの実行規則の変更

## Implementation notes

- `scheduled_tasks` は明示的な将来実行の正本であり、定期Eventの起動時刻を持つ`autonomous_schedules`とは別パネルにする。
- 既存Overview queryの読取り専用境界を維持する。

## Acceptance criteria

- [x] AC-047-1：選択中AgentのScheduled TaskがOverviewに表示され、予約日時・指示・状態・試行回数を簡潔に確認できる。
- [x] AC-047-2：詳細表示で予約理由、配送先、実行Event、失敗理由を確認できる。
- [x] AC-047-3：Debug UIは読取り専用で、Agent所有者で絞った既存query境界を維持する。

## Tests

- NFR-12：HTMLにScheduled Taskパネルと予定・状態の要約表示を含める。
- NFR-12：Overview queryがAgent IDで`scheduled_tasks`を絞る既存契約を維持する。

## 実装メモ

- `scheduled_tasks` は既存のOverview読取りに含まれていたため、新しいAPIや書込み経路は追加していない。
- 一覧は先頭8件の予約日時・指示・状態・試行回数、詳細は既存取得済みの全列を表示する。
- `tests/unit/debug-ui.test.ts` に画面表示契約を追加した。`pnpm test`（240件）、`pnpm typecheck`、`pnpm lint`、`trace_check.py --root .` は成功した。
