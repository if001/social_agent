---
created_at: 2026-10-10
status: done
---

# 110: Intention状態を削除する

## Background

Intentionには探索継続、対話機会待ち、行動方針、時刻Trigger、ユーザーへの約束が混在し、外部条件待ちのIntentionが自律行動全体を停止させている。Scheduled Task導入後は予約実行を移し、通常の自律行動をDriveとCurrent Interestからその都度選択する構造へ変更する。

## Dependencies

- Issue 107
- Issue 108
- Issue 109

## Scope

- Intention Domain Contract、Proposal、Trigger、Context入力を削除する
- `intentions`、`memory_intentions`と関連index / repository / queryを削除するDrizzle migrationを生成する
- Continuity Post-processからIntention proposalを削除する
- Intention Scheduler、trigger activation、review interval、Debug UI表示を削除する
- MemoryとSocial Context選択からIntention依存を除去する
- Drive、Current Interest、Observation、Mood、Emotion、PreferenceからActionを直接選ぶpromptへIntention参照を除去する
- Intentionが担っていた予約実行をScheduled Task、知識をMemory、動機をDrive / Current Interestへ移したことを確認する
- 不要な環境変数、docs、testsを削除する

## Out of scope

- Drive / Current Interestのライフサイクル強化。Issue 111で行う
- 自律Scheduleの統合。Issue 111で行う
- 失敗RunのOutcome反映。Issue 111で行う

## Implementation notes

- 「次の対話まで待つ」は状態として保存しない。関連知識はMemory、継続動機はDrive / Current Interest、明示的な予約はScheduled Taskへ分離する。
- 後方互換は残さず、Intention関連コードとDB構造を削除する。
- 失敗retryが通常review間隔を上書きしてRun stormを作らないよう、Provider一時障害とdeadline到達を分けて扱う。

## Acceptance criteria

- Agent Core、Post-process、Context、DB、Debug UIにIntentionが残っていない
- 時刻指定や約束はScheduled Taskで実行できる
- 外部条件待ちを理由に自律行動全体が停止しない

## Tests

- Intention参照が残っていないことのsource scan
- Scheduled Task回帰test
- Drizzle migration integration test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:system`
- DB integration test

## References

- [Issue 107](./107-document-motivation-and-scheduled-task-model.md)
- [Issue 108](./108-remove-desire-from-interaction-state.md)
- [Issue 109](./109-add-tool-created-scheduled-tasks.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Architecture](../docs/ARCHITECTURE.md)
