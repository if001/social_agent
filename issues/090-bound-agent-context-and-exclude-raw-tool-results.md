---
created_at: 2026-10-07
status: created
---

# 090: Agent Contextを有界化してraw Tool Resultの再投入を止める

## Background

直近の`web_page` Tool Result Eventが81,054文字あり、直近6件だけで約23,000 token相当になっていた。現在のContext BuilderはRecent Observation、Self、Active Intention、Tool Schema等を必須Contextとして無制限に含め、24,000 token上限を超えると縮小せず例外にする。

## Dependencies

- Issue 088
- Issue 089

## Scope

- `tool-result` Eventをraw contentのままRecent Observationへ含めない
- Tool結果履歴はboundedなRecent Attempt、Memory、Web Snapshot metadataから構成する
- Recent Observation、現在Observation、Self長文、Intentionへ件数・文字数上限を設ける
- Tool定義の入力JSONへの重複を削減し、Deep Agent登録済みSchemaとの責務を整理する
- 必須Contextも優先順位に従ってbudget内へ縮小する
- カテゴリ別の文字数・token概算・除外理由を安全にログへ出す
- post-process snapshotへraw Tool Resultやraw Web本文が入らないことを保証する
- Context超過時にScheduler全体を失敗させず、診断可能なDomain Errorまたはbounded fallbackを返す

## Out of scope

- model固有の厳密Tokenizer
- Memory検索rankingの全面変更
- debug prompt全文ログの恒久運用方針

## Implementation notes

- 実データで確認した直近最大Tool Resultは81,054文字だった。
- Recent Observationでは会話上必要なUser / Agent / External Eventを優先し、Tool provenanceは別projectionで渡す。
- raw本文はIssue 089のfileを正本とし、必要時だけSnapshot Toolで読む。

## Acceptance criteria

- 大きなWeb page取得後も次のEventのContext構築が成功する
- Recent ObservationがTool Resultで埋め尽くされない
- 各Contextカテゴリが明示した上限を超えない
- 超過時に何を削除したかログとtraceで確認できる
- 会話継続に必要なUser / Agent Observationが優先される
- raw Web本文がInteraction、post-process、後続runのpromptへ再投入されない

## Tests

- 100,000文字のTool Result後のContext構築test
- User / Agent Observation優先test
- カテゴリ別budget・文字数・除外理由test
- Active Intention / Self長文のbounded projection test
- post-process inputのraw本文非包含test
- persistent-drive / autonomy-review回帰test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:system`

## References

- [Issue 088](./088-align-docs-for-shared-file-backed-web-archive.md)
- [Issue 089](./089-implement-shared-file-backed-web-archive.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
