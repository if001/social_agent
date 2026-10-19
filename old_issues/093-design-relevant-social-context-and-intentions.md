---
created_at: 2026-10-07
status: done
---

# 093: Social ContextとActive Intentionの関連選択を設計する

## Background

現在のContext Loaderは、対象AgentのSocial Contextを全件取得して更新日時順の最大24件、Active Intentionを全件取得してID順の最大16件までAgent Coreへ渡す。今回のObservation、actor、Current Interest、Memory、Triggerとの関連性は選択条件になっていない。

概念設計では、Agent State全体を毎回渡さず、Context BuilderがObservationに関連する情報を選ぶ。現状は件数と文字数だけを制限しているため、長期運用で無関係な関係認識や行動方針がPromptを圧迫し、関連Memoryを押し出す可能性がある。

## Scope

- `spec/`を一次情報としてSocial Context、Intention、Observation、Memory Retrieval、Agent Core Inputの責務を確認する
- 現在のSocial Context／Active Intentionの生成、更新、完了、取得、Context投入経路を調査する
- 実DBで件数、文字量、重複、古いactive状態、無関係な対象が残る条件を確認する
- Social Contextを現在Eventのactor／subject、関連Memory、関連Intention、Project／Team文脈、更新時刻から選択する方式を設計する
- Active IntentionをEvent Trigger、`nextReviewAt`、関連subject、Current Interest、関連Memory、再評価時刻から選択する方式を設計する
- Context上限とは別に、関連度と用途に基づく小さい件数上限を決める
- 選択理由と除外理由の観測方法を設計する
- 採用方針を`docs/`へ反映する
- Issue 094の実装範囲とAcceptance criteriaを設計結果に合わせて見直す

## Out of scope

- コードの修正
- `recentAttempts`とMessage履歴の責務整理
- Social Context本文やIntention本文を生成するPost-process Promptの全面再設計
- Memory Retrieval全体のranking刷新
- Social Contextを数値的なSocial Graphへ変更すること
- Intentionを巨大なFSMへ変更すること

## Implementation notes

- Social Contextの候補優先度は、現在actorとの完全一致、Eventが明示するTeam／Project、選択Memoryの関連subject、関連Intention、更新時刻の順を基本案とする。
- Active Intentionの候補優先度は、現在Eventに一致するtrigger、期限到来、現在subject／Current Interest／Memoryとの関連、最近の再評価の順を基本案とする。
- 関連付けに利用できる明示IDを優先し、曖昧なLLM relevance判定だけへ依存しない。
- active件数が上限を恒常的に超える場合は、Context切り捨てだけでなく完了・破棄・統合ライフサイクルの不足として扱う。

## Investigation result

- 現行LoaderはSocial ContextをAgent単位で全件・`updated_at DESC, id`順、Active Intentionを全件・`created_at, id`順に取得する。Context Builderがそれぞれ24件と16件へ切り詰めるため、現在Eventとの関連性は選択に使われない。
- Memory queryも上記配列の先頭8件を使うため、無関係な状態がMemory検索条件を汚し、取得後はMemoryより先にContext budgetを消費する。
- 既存DBを本文非表示の集計Queryで確認した時点では、Social ContextとActive Intentionはいずれも0件だった。実データ分布による閾値調整はIssue 094のsynthetic testと運用traceで行う。
- DBにはMemoryからsubject／Intentionへの明示linkがある。IntentionからCurrent Interestまたはsubjectへの直接linkはないため、Memory linkを主経路、Current Interestとのkeyword一致を補助経路とする。

## Adopted design

- Memory検索前にObservation actor／明示subjectと直接対象／trigger／期限からseedを選び、検索後にMemoryの関連IDで補完する2段階選択とする。
- Social ContextとActive Intentionは各6件、fallbackは各2件までとする。Social Context本文は600文字、Intentionのdescription／reasonは各500文字へprojectionする。
- 優先順位、tie-break、fallback、Context budget順、stale active診断、`context.selection` logの項目は`docs/ARCHITECTURE.md` §5.5.2を正とする。
- 再評価経路がないactive Intentionを古さだけで削除しない。直接対象または関連linkがなければ通常Contextへ含めず、診断件数として記録する。

## Acceptance criteria

- 現行取得方式と概念設計との差分が説明されている
- Social ContextとActive Intentionの候補生成、ranking、件数上限、文字数上限が決まっている
- actor、Event、Trigger、期限、Current Interest、Memoryとの関連付け規則が決まっている
- 関連対象がない場合のfallbackが決まっている
- 選択・除外理由の観測方法が決まっている
- 長期運用時のstale active Intentionの扱いが決まっている
- `docs/`が採用方針と整合している
- Issue 094が実装可能な具体性になっている

## Tests

- ドキュメント内の型、件数、優先順位、fallbackの整合確認
- `spec/`のSocial Context／Intentionライフサイクルとの矛盾確認
- Issue 094のテストケース確認

## References

- [Concept Design §10 Desire / Intention](../spec/personal-agent-concept-design-restructured-v2.md#10-desire--intention)
- [Concept Design §11 Social Context](../spec/personal-agent-concept-design-restructured-v2.md#11-social-context)
- [Implementation Design §14 Intention lifecycle](../spec/personal-agent-implementation-design-v2.md#14-intentionのライフサイクル)
- [Implementation Design §15 Social Context](../spec/personal-agent-implementation-design-v2.md#15-social-context)
- [Implementation Design §17 Memory Retrieval](../spec/personal-agent-implementation-design-v2.md#17-memory-retrieval)
- [Issue 090](./090-bound-agent-context-and-exclude-raw-tool-results.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Requirements](../docs/REQUIREMENTS.md)
