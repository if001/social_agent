---
created_at: 2026-10-08
status: done
---

# 100: Debug UIのRun履歴にInternal Event種別を表示する

## Background

Run履歴のEvent列がすべて`internal`と表示され、`state-review`、`autonomy-review`、`persistent-drive`、Intention Review等を一覧で判別できない。

## Dependencies

- なし

## Scope

- Event Observationの`content.targetKind`をRun一覧APIへprojectionする
- Internal Eventを`internal / <targetKind>`形式で表示する
- `targetKind`を持たない既存Eventは`internal`と表示する

## Out of scope

- Event優先度やScheduler処理の変更
- 保存済みEventの更新
- Run詳細画面の再設計

## Implementation notes

- DBに保存済みの構造化Observationを使用し、summary本文から種別を推測しない。
- HTMLへ表示する値は既存のescapingを通す。

## Acceptance criteria

- Run履歴だけでInternal Eventの`targetKind`を判別できる
- User Message等の表示は従来どおりである
- 古いInternal Eventの表示が壊れない

## Tests

- Run一覧queryのInternal Event種別projection test
- Debug UI表示処理の回帰test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`

## References

- [Architecture: Scheduler](../docs/ARCHITECTURE.md)
