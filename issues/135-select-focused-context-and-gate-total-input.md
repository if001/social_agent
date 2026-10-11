---
created_at: 2026-10-11
status: done
---

# 135: 関連状態を選択しModel入力全体を6,000 token以下に制限する

## Background

[敵対レビューの致命的指摘3と重要な指摘9](../note/adversarial-review-2026-10-11.md)では、Context Builderが状態を上限まで詰め、実際のmodel callに加わるprompt、Tool schema、output schema、履歴を予算へ含めていないと指摘されている。[実装設計 §2](../spec/personal-agent-implementation-design-v2.md)が定義するContext Builderは、状態を全部渡す層ではなく関連情報を選ぶ薄い層である。

## Scope

- Identity、Values、Dispositionの核を合計500〜800 tokenへ縮約する選択規則を設ける。
- 現在のMood、Emotion、競合Motive上位3件、対象相手のSocial Context 1件、関連Memory 3〜5件、直近2〜4 turnを選ぶ。
- Tool説明、system prompt、output schema、会話履歴を含む最終model inputを計測し、6,000 token以下でgateする。
- 超過時は優先順位の低いMemory、履歴、状態の順に選択数を減らす。
- `memoryRetrievalTrace`をAgent Coreの正式入力から外し、診断側へ移す。

## Out of scope

- Memory ranking modelそのものの全面刷新。
- Selfの永続データを削除または要約して上書きすること。
- Long-term Reviewの入力予算変更。

## Implementation notes

- [概念設計 §14・§23](../spec/personal-agent-concept-design-restructured-v2.md)の意味解釈に必要な因果を優先する。
- token計測はContext JSONだけで完結させず、providerへ渡す最終message/tool定義を対象にする。
- 予算超過は単純な文字途中切断を避け、項目単位の決定的な縮退にする。
- 修正時はレビューの「推奨する最小構成」と一次資料を参照し、監査情報を認知入力へ戻さない。

## Acceptance criteria

- 本番既定値で最終model入力が6,000 tokenを超えない。
- 同じ入力と状態から同じfocusが選ばれる。
- 対象相手以外のSocial Contextや低関連Memoryを通常入力へ載せない。
- 選択から落とした永続状態を削除しない。
- 予算内に収まらない場合は、どの構成要素が原因か診断できる。

## Tests

- focus selectionのunit test。
- system prompt、Tool/output schema、履歴を含むtoken budget test。
- 大量のMotive、Memory、Social Contextを持つ境界値test。
- 本番compositionのcontract test、typecheck、lint。

## Dependencies

- なし

## Source plan

- [敵対レビュー: P0-2、P1-4](../note/adversarial-review-2026-10-11.md#実施順序)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
