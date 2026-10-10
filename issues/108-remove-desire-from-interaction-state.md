---
created_at: 2026-10-10
status: done
---

# 108: DesireをInteraction状態から削除する

## Background

DesireはDriveやCurrent Interestと同じく動機として扱われ、現在のAction選択に重複した中間状態を追加している。実装ではDesireとActionを同じLLMが同時に出力するため、DesireがAction生成へ使われた保証もない。Drive、Current Interest、Emotion、Mood、Preference、ObservationからActionを直接選択する契約へ簡素化する。

## Dependencies

- Issue 107

## Scope

- Agent Core出力から`desires`の即時状態更新を削除する
- Immediate StateをEmotionだけに限定する
- DriveとCurrent InterestがActionへ直接影響する日本語promptへ変更する
- Intention生成規則からDesire依存を除去する。ただしIntention本体の削除はIssue 110で行う
- Domain Schema、State Update Service、監査記録、Debug UI、評価fixtureを更新する
- tests、docs内の実装契約参照をIssue 107の設計へ合わせる
- 不要になったDesire用コードを削除する

## Out of scope

- DriveまたはCurrent Interestの統合
- Intentionテーブルの削除
- Scheduled Task実装
- Mood / Emotionの新しい分類追加

## Implementation notes

- 「したくない」はDesireとして保存せず、競合するDrive / Current Interest、Emotion、Mood、Preference、Runtime ConstraintをAction選択で比較する。
- Interaction出力Schemaを小さくし、後方互換用の`desires`受理は残さない。
- 過去RunのJSON結果を新Schemaへ移行する必要はないが、Debug UIが旧結果で停止しないことを確認する。

## Acceptance criteria

- Agent CoreがDesireを生成・保存しない
- ActionがDrive、Current Interest、Emotion、Mood、Preference、Observationから直接選ばれる
- `desires`を含む新規出力がSchemaで拒否される
- Debug UIとRecent ExperiencesがDesireなしで表示できる
- Interaction出力Schemaが従来より単純になる

## Tests

- Agent Core output contract test
- Desireを含む旧出力の拒否test
- State Update Service test
- Interaction prompt contract test
- Runtime / Debug UI regression test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:system`

## References

- [Issue 107](./107-document-motivation-and-scheduled-task-model.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Architecture](../docs/ARCHITECTURE.md)
