---
created_at: 2026-10-11
status: done
---

# 140: 現在のEmotionを短期状態として保持しAction判断へ反映する

## Background

[敵対レビューの致命的指摘2](../note/adversarial-review-2026-10-11.md#2-emotionは次のeventへ残らず現在のactionにも構造的に効いていない)では、Emotionがproposalと監査文面に留まり、次EventにもAction決定の前段にも効かないと指摘されている。[概念設計 §9・§14・§19](../spec/personal-agent-concept-design-restructured-v2.md)と[実装設計 §4・§5.2・§11](../spec/personal-agent-implementation-design-v2.md)は、Emotionを短期状態として扱い、必要なら次Eventへ影響させる。

## Scope

- Dynamic Stateへ現在のEmotion、発生時刻、根拠Eventを保持する。
- 新Event、時間経過、明示的な状態更新による上書き・減衰・解消規則を設ける。
- focus selectionで現在のEmotionをAction decisionの明示入力にする。
- 同じObservationでもEmotion/Motive差がchosen MotiveとActionへ反映されたことを記録できるようにする。

## Out of scope

- 感情カテゴリや数値強度の固定リスト化。
- `anger -> refuse`のような固定Action規則。
- MoodをEmotionへ統合すること。

## Implementation notes

- 「Emotionは原則Transient」と「次Eventへ影響する必要があれば保持」を両立させ、無期限保存しない。
- generated EmotionとActionの文章的一貫性だけを因果の証明にしない。
- persistence migrationでは既存AgentをEmotionなしの状態として安全に読めるようにする。
- 修正時はレビューと一次資料を参照し、感情的な口調をpersonaへ直書きしない。

## Acceptance criteria

- Emotionが発生時刻と根拠を伴って次EventのContextへ入る。
- 減衰・上書き・解消後は古いEmotionが判断へ残らない。
- MoodとEmotionを別の時間スケールとして保持する。
- 状態差の記録からEmotion、chosen Motive、Actionの関係を追跡できる。

## Tests

- persistence migrationとrepository contract test。
- 発生、次Eventへの持越し、減衰、上書き、解消のunit/system test。
- 同一ObservationでEmotionだけを変える対照contract test。
- typecheck、lint。

## Dependencies

- 135
- 137

## Source plan

- [敵対レビュー: P1-1](../note/adversarial-review-2026-10-11.md#p1-自律性を状態から駆動する)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
