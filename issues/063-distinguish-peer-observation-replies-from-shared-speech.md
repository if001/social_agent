---
created_at: 2026-11-21
status: done
type: change
plan: []
requirements: [FR-76, FR-88, FR-90, NFR-8, NFR-9, NFR-10]
ui: []
requires: agent
---

# 063 peer観測への返信と共有発話を分離する

## Background

allowlist peerの非mention投稿は`message-received/peer/observed`として受理する。現行の`respond.content`は、投稿への返答と投稿を契機にした独立した共有発話を区別せず、どちらも非mention・非threadで配送する。そのため、特定peerへの返答が誰宛てかDiscord上で分からない。

## Dependencies

- 062

## Scope

- `peer/observed`について、独立した共有発話、source投稿へのthread返信、明示peerへのmentionを別のAction routeとして表す。
- `respond.content`を宛先を持たない共有発話に限定する。
- `respond.observedReply.content`をsource投稿への返信として追加し、Runtimeだけがsourceのreply contextを復元する。
- `respond.peer`は既存どおり、自然言語表示名によるallowlist peerへのmentionとして維持する。
- Requirements、Architecture、Event overview、social-message skill、schema description、Runtime、Discord Adapter、testを一致させる。

## Out of scope

- allowlist外peerの受理
- peerごとの別Concern又は別認知pipeline
- shared発話への応答回数や連投を抑制する社会的制御

## Acceptance criteria

- [x] AC-063-1：`peer/observed`で、独立共有発話は非mention・非thread、source返信は元投稿へのDiscord reply/thread、明示peer発話はmentionとして配送される。
- [x] AC-063-2：モデルはIDやreply metadataを出力せず、`observedReply`の自然言語本文だけを出力する。
- [x] AC-063-3：direct human / peerと自律Eventの既存配送は変えず、無効なroute metadataは送信しない。
- [x] AC-063-4：schema / skill / Runtime / Adapterの契約testが3 routeと無効routeを検証する。

## Tests

- FR-88：peer observedの共有発話、source返信、peer mentionをAdapter contract / Runtime testで検証する。
- FR-76：peer observedが無応答を選べ、既存の自律発話routeを維持することをtestする。
- NFR-8 / NFR-9 / NFR-10：Outbox原子性、allowlist再検証、reply metadataの検証をtestする。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-88 | `peer/observed`の共有発話・thread返信・mention配送を区別する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-76, FR-90 | 発話可能Eventと共通認知loopを維持したroute分離を明記する | `docs/REQUIREMENTS.md` |
| MODIFIED | ADR-21 | social Action route tableを更新する | `docs/ARCHITECTURE.md` |
| MODIFIED | Event overview | peer/observed配送表を更新する | `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` |

## 影響範囲

検索した語：`peer/observed`、`respond.content`、`respond.peer`、`replyContext`、`message-received`

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/domain/contracts.ts` | Action schema / description | 更新する |
| `src/application/agent-runtime.ts` | route解決とOutbox payload | 更新する |
| `src/infrastructure/ui/discord-adapter.ts` | mention / reply context配送 | 更新する |
| `skills/social-message/SKILL.md` | observedでのAction選択 | 更新する |
| `docs/REQUIREMENTS.md` | FR-76 / FR-88 / FR-90 | 更新する |
| `docs/ARCHITECTURE.md` | ADR-21 | 更新する |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | 配送表 | 更新する |
| `tests/contract/discord-adapter.contract.test.ts` | Discord route | 更新する |
| `tests/system/*` | Runtime route | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | C-09 / C-16 / C-17と矛盾せず、配送routeの詳細化のため変更不要 | 不要 |
| `docs/REQUIREMENTS.md` | FR-76 / FR-88 / FR-90を更新 | 反映済み |
| `docs/ARCHITECTURE.md` | ADR-21を更新 | 反映済み |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | peer/observed routeを更新 | 反映済み |

## 実装メモ

- `respond.observedReply: { content }`を追加した。`content`はobserved投稿を契機にした独立共有発話、`peer`は明示mention、`observedReply`はsource投稿へのreply/threadであり、後者は他routeと併記できない。
- Runtimeは`peer/observed`かつchannelIdとmessageIdを持つ監査contextだけからreply envelopeを作る。条件外の`observedReply`は外部送信しない。
- 上流への反映：FR-76 / FR-88 / FR-90、ADR-21、Event overview、social-message skillへ反映済み。`spec/`は配送routeの詳細化であり変更不要。
- 検証：`pnpm test`（261件）、`pnpm test:system`（57件）、`pnpm typecheck`、変更範囲のESLint、`trace_check.py`（ERROR 0、既存WARN 7）。
- レビュー相当の変更照合：`docs/work/analyze/2026-11-21-change-063.md`。
