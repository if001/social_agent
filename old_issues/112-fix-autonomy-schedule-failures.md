---
created_at: 2026-10-11
status: done
---

# 112: 廃止済み自律ScheduleとTool反復エラーを修正する

## Background

Motive統合後もDBに`persistent-drive` Scheduleが残り、新しいSchedulerが未知のkindをclaimして再試行している。また、直近Eventと同一のTool入力を検出した際にTool結果ではなく例外をDeep Agentへ送るため、`autonomy-review`全体が`Agent provider failed`になる。

## Scope

- 廃止済み`persistent-drive` Scheduleをmigrationで削除する
- Schedule Repositoryが許可されたkindだけをclaimする
- 直近と同一のTool入力を副作用なしの失敗結果としてAgentへ返す
- regression testを追加する

## Out of scope

- Motiveモデルの再設計
- LLM modelやtimeout値の変更

## Implementation notes

- DBの古いデータだけに依存せず、Repository境界でも未知kindを除外する
- Tool反復検出は実行を拒否するが、Agent loopは継続して別のActionを選べるようにする

## Acceptance criteria

- `persistent-drive`がSchedulerから起動されない
- 既存の`persistent-drive` Scheduleが削除される
- 同一Tool入力でAgent run全体がprovider failureにならない
- `autonomy-review`が別のToolまたは最終Actionへ進める

## Tests

- Schedule Repository integration test
- Deep Agent Tool loop system test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:system`
- DB integration test

## References

- [Agent Motivation Model](../docs/AGENT_MOTIVATION_MODEL.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Issue 111](./111-reconnect-drive-interest-autonomy.md)
