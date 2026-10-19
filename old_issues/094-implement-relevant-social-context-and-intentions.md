---
created_at: 2026-10-07
status: done
---

# 094: 関連するSocial ContextとActive IntentionだけをAgent Contextへ選択する

## Background

Issue 093で決定した設計に基づき、更新日時またはIDだけでSocial ContextとActive Intentionを選ぶ現在の実装を修正する。

## Dependencies

- Issue 093

## Scope

- Context LoaderでSocial ContextとActive Intentionの候補を有界に取得する
- Memory検索前のseed選択と検索後のMemory link補完を分けて実装する
- Social Contextをactor／明示subject、Memory subject、Intentionと同じMemoryのsubject、fallbackの順で選択する
- Active Intentionをscheduler直接対象、成立Trigger、期限、Memory link、Current Interest keyword、fallbackの順で選択する
- Context Builderでrankingと件数・文字数上限を適用する
- 関連Memoryを不必要に押し出さないContext budgetの優先順位へ修正する
- 選択理由と除外理由をdebug logまたはtraceへ追加する
- 不要になった更新日時順／ID順だけの選択処理を削除する
- unit、integration、system testを追加する

## Out of scope

- Issue 093で決定していない新しい関連度モデルの追加
- `recentAttempts`やMessage履歴の修正
- Social Context／Intention生成Promptの全面変更
- Memory Retrieval全体のranking刷新

## Implementation notes

- 実装前にIssue 093の最終docsとAcceptance criteriaを確認する。
- DB Queryだけで確定できる条件と、Memory取得後にContext Builderで確定する条件を分ける。
- 明示的なsubject／intention linkを曖昧な文字列類似より優先する。
- active件数過多を黙って隠さず、診断可能な情報を残す。

## Acceptance criteria

- Social Contextが更新日時だけで最大24件選ばれない
- Active IntentionがID順だけで最大16件選ばれない
- 現在のactor、Event、Trigger、期限、Current Interest、関連Memoryに結びつく候補が優先される
- 選択件数と各文字数がIssue 093の上限以内である
- 無関係なSocial ContextとIntentionが関連MemoryをContextから押し出さない
- Trigger到来または期限到来したIntentionがContextから欠落しない
- 選択・除外理由を確認できる
- Social ContextとActive Intentionが各6件以内、fallbackが各2件以内である
- Social Context本文が600文字以内、Intentionのdescription／reasonが各500文字以内である
- 再評価経路のないactive Intentionが診断され、直接または関連linkなしに通常Contextへ混入しない
- 必須候補が6件を超えた場合にoverflowを観測でき、選択順が安定している
- Issue 093で更新したdocsと実装が一致する

## Tests

- 現在actorに対応するSocial Contextの優先選択test
- 関連Memory／Intentionが参照するSocial Contextの選択test
- 無関係で新しいSocial Contextが関連対象を押し出さないtest
- Event Trigger／期限到来Intentionの優先選択test
- Current Interest／Memory関連Intentionの選択test
- Memory検索前seedと検索後link補完のtest
- 関連候補なし、fallback最大2件、必須候補overflowのtest
- 本文projectionと本文を含まないselection logのtest
- stale active Intentionと件数上限test
- Context budget内でMemoryが不必要に押し出されないtest
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:system`

## References

- [Issue 093](./093-design-relevant-social-context-and-intentions.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
