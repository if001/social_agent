---
created_at: 2026-11-22
status: done
type: change
plan: []
requirements: [FR-88, NFR-10]
ui: []
requires: agent
---

# 070 Discord reply chainのhopをBot内メモリで復元する

## Background

Discord Adapterは受信投稿を常に新規 ingress (`hop: 0`) として正規化する。そのため、
Runtimeの`RUNTIME_MAX_HOPS`はDiscord replyを経由するBot間の往復を止められない。

Bot自身が送ったDiscord message IDへの返信だけは、送信済みmessage IDと因果情報をそのBot
自身のプロセスメモリに短期保持すれば復元できる。ユーザーは再起動時の消失を許容し、DB、
Redis、Bot間共有Map、通常投稿・新規mentionの因果復元を求めない。

## Dependencies

- #069 done

## Scope

- Discord Adapterが自Botの送信成功時に、Discord message IDをキーとして`correlationId`、
  outbound hop、causation action ID、有効期限をプロセス内Mapへ保持する。
- allowlist peerからの受信投稿が、そのMap内の自Bot送信message IDを`referencedMessageId`として
  持つ時だけ、correlation IDを継承しhopを1増やしてRuntimeへ渡す。
- 期限切れentryを入出力時に除去する。process再起動、Map miss、reply先なし、受理済みowner human
  投稿は新規 ingressとして`hop: 0`を維持する。allowlist外Botは従来どおりEventを作らない。
- 既存の`actionByDiscordMessage`によるcausation復元を同じ短期entryへ統合する。

## Out of scope

- DB、Redis、複数Bot process間で共有するtrack store
- 通常投稿、独立共有発話、または新規mentionのhop復元
- 再起動をまたぐ因果追跡、監査用の永続correlation ledger
- Gate / `no-external-action`による意味的会話終端の変更

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-88 | Discord reply chainだけは自Bot process内の短期Mapからcorrelation / hopを復元し、Map missは新規 ingressにする | `docs/REQUIREMENTS.md` |
| MODIFIED | NFR-10 | hop上限をreply chainで実効化する短期メモリの寿命と非永続性を明記する | `docs/REQUIREMENTS.md` |
| MODIFIED | ADR-21 | Discord ingressのreply-chain transport復元を記載する | `docs/ARCHITECTURE.md` |

## 影響範囲

検索した語：`referencedMessageId`、`actionByDiscordMessage`、`correlationId`、`hop`、`DiscordAdapter`

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/infrastructure/ui/discord-adapter.ts` | outbound短期Map、inbound reply復元 | 更新する |
| `src/infrastructure/ui/discord-js-gateway.ts` | reply message IDを受信metadataへ渡す | 更新しない（既に渡す） |
| `src/application/agent-runtime.ts` | hop制限とoutbound envelope | 更新しない（既存の検証を使う） |
| `docs/REQUIREMENTS.md` | FR-88、NFR-10 | 更新する |
| `docs/ARCHITECTURE.md` | ADR-21 | 更新する |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | 受信時のtransport説明 | 更新する |
| `tests/contract/discord-adapter.contract.test.ts` | reply chainのcorrelation / hop復元、Map miss / expiry | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | C-20 / C-27のRuntime制約内にあるtransport実装詳細のため変更不要 | 不要 |
| `docs/REQUIREMENTS.md` | FR-88、NFR-10を更新 | 承認済み（本Issueの方針） |
| `docs/ARCHITECTURE.md` | ADR-21を更新 | 承認済み（本Issueの方針） |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | reply chainのtransport説明を更新 | 承認済み（本Issueの方針） |

## Acceptance criteria

- [x] AC-070-1：自Bot送信messageへのallowlist peer replyは同じcorrelation IDと、送信時hopより1大きいhopでRuntimeへ渡る。`FR-88, NFR-10` contract test。
- [x] AC-070-2：Map miss、期限切れentry、reply先なし、受理済みowner human投稿は新規 ingressとして`hop: 0`を維持し、allowlist外BotはEventを作らない。`FR-88, NFR-10` contract test。
- [x] AC-070-3：短期entryは送信envelopeのexpiryで失効し、DBへの保存を行わず、既存causation復元を維持する。Adapter実装と既存・追加contract test。
- [x] AC-070-4：差分が正の文書に反映され、上流への反映がすべて反映済み又は不要であり、`spec-analyze change` にCRITICAL / HIGHがない。`docs/work/analyze/2026-11-22-change-070.md`。

## Tests

- FR-88：allowlist peerのDiscord reply chainだけがcorrelation / hopを復元し、他の入力を新規 ingressとして扱うcontract test。
- NFR-10：expiry後に短期entryを使わず、Runtimeの既存hop上限へ復元値を渡すcontract test。

## 実装メモ

- `DiscordAdapter`のBot process内Mapは、配送成功したDiscord message IDにaction ID、correlation ID、hop、envelope expiryを保持する。入出力時にexpiry済みentryを除去し、DB・Redis・Bot間共有は追加しない。
- `tests/contract/discord-adapter.contract.test.ts`に、allowlist peer replyのcorrelation / hop復元、期限切れ、Map missの新規 ingressを追加した。既存のhuman replyに対するcausation復元も維持する。
- 検証：`pnpm test`（270 tests）、`pnpm test:system`（63 tests）、`pnpm test:evaluation`（15 tests）、`pnpm typecheck`、scoped ESLint、`trace_check`（ERROR 0、既存WARN 7）。
- 独立レビュー：`docs/work/reviews/2026-11-22-issue-070.md`。MEDIUM 1件を文書・受け入れ条件の明確化で解消した。spec-analyze change：`docs/work/analyze/2026-11-22-change-070.md`（CRITICAL / HIGH 0）。
