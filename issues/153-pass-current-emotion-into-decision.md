---
created_at: 2026-10-11
status: done
---

# 153: 現EventのMeaningとEmotionをAction判断へ明示的に渡す

優先度: P1

## Background

[敵対再レビュー](../note/adversarial-rereview-2026-10-11.md)の「指摘5」への対応。同一最終outputでEmotionとActionを生成する構造だけではSubjective Meaning -> Emotion -> Decisionの因果が表現されない。

## Scope

- Meaning/Emotionの構造化結果を先に確定し、Action判断へ渡す境界を実装する。
- 当該EventのEmotionと前Eventから保存されたEmotionを区別する。
- 追加callによるlatency・modelCalls・入力量と行動差を測定する。

## Out of scope

- Emotionラベルの固定人格化、無条件の無制限call増加、後処理全体の再設計。

## Implementation notes

- 既存契約とpromptを最小限変更し、各段へ149・150の予算を適用する。
- 単一outputの説明欄追加だけで完了としない。採用する段階化とcall数・遅延のtrade-offを記録する。
- 148の基準測定と同条件で比較し、評価結果をもとに改善の主張を判断する。

## Acceptance criteria

- Action判断入力に現Eventの確定Meaning/Emotionが含まれることをtraceで確認できる。
- 前段失敗や予算不足が無検査のActionへ流れない。
- 現Emotionの条件差とlatency/costの実測が残る。

## Tests

- 段階間データ受渡し、前段失敗、EmotionのEvent境界、予算超過テスト。
- 関連system testとpaired live再評価、typecheck、lint。

## Dependencies

- [149](149-gate-every-model-call-input.md)
- [150](150-account-actual-model-calls.md)
- [148](148-run-paired-live-evaluation-and-gate.md)

## Source plan

- [敵対再レビュー（2026-10-11）: 指摘5](../note/adversarial-rereview-2026-10-11.md)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
