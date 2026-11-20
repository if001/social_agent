---
created_at: 2026-11-20
status: stop
type: feature
plan: []
requirements: [FR-77, FR-88, NFR-8, NFR-9, NFR-10, NFR-22]
ui: []
requires: agent
---

# 056 `respond`で自発的peerへのDiscord mentionを配送する

> 置換済み：#061で`message-received`を正本に再設計したため、配送だけを独立して実装する本Issueは#062へ統合する。ここでは実装しない。

元計画：[#052](052-design-canonical-subject-registry-for-multi-bot.md)の`respond.peer`配送設計

## Background

allowlist Botへの返信だけでなく、idle等でAgentが自発的に許可済みpeerへ話しかけられるようにする。最終ActionはC-17の4種類を維持し、既存`respond`の任意peer宛先をRuntimeが配送先として解決する。

## Dependencies

- 055

## Scope

- `respond`に任意の`peer: { name, content }`を追加し、Agent Coreから受ける。いずれも自然言語だけであり、永続IDを持たない。
- Runtimeがpeer名をそのAgentのallowlist内で一意に解決し、Outboxへ検証済み配送metadataを保存する。
- Discord Adapterが配送metadataをallowlistと再照合し、peer Botへの`<@discordUserId>` mentionを付けて指定channelへ送る。
- allowlist Bot由来Eventの`respond.content`は、その検証済みpeerへ返信として配送する。
- `idle` / `concern-due`はFR-76どおり`respond.content`をユーザーへ必ず配送し、任意の`peer`があれば同一transactionで独立したpeer Outboxを追加する。人間の`user-message`は`respond.content`だけをユーザーへ配送し、`peer`を許可しない。
- allowlist peer由来`user-message`は`respond.content`だけを検証済み送信peerへ返信し、`peer`を許可しない。`external-change`、`scheduled-task`、`prediction-g3-result`とその他のEventでは`peer`を許可せず、既存のEvent別配送先を維持する。
- 未登録・曖昧・self・channel未設定・metadata不正ではpeer Outboxを作らない。`idle` / `concern-due`のユーザーOutboxは維持し、peer由来Eventでは外部配送を作らない。候補と拒否理由はRunのAction監査に残す。

## Out of scope

- `respond`以外のAction種別追加
- allowlist外へのBot送信
- Discord以外のpeer配送

## Implementation notes

- LLMはcanonical ID、Discord ID、local handleを読まず書かない。peerの自然言語名の曖昧さはRuntimeがfail-closedする。
- peer宛て`respond`の選択はAgentの意思であり、userへの発話を補助する配送ではない。ただし`idle` / `concern-due`では、FR-76のユーザー発話を置換できない。Action schemaとRuntime route tableでこの差を固定する。
- metadataはLLMを経由させず、Outbox transactionでActionとともに保存する。Discord Adapterはmetadataを信頼せず、現行allowlistで再検証する。

## Acceptance criteria

- [ ] AC-056-1：Agent CoreはID-freeな`respond.peer.name`と`respond.peer.content`だけでpeer宛て配送候補を出力できる。
- [ ] AC-056-2：Runtimeは一意なallowlist peerだけをOutbox配送metadataへ解決する。
- [ ] AC-056-3：Discord Adapterは検証済みpeerへのmentionを付け、allowlist外・metadata不正なら送信しない。
- [ ] AC-056-4：user宛てとpeer宛ての`respond`は配送先・監査・失敗規則が混ざらない。
- [ ] AC-056-5：peer由来、`idle` / `concern-due`、人間`user-message`のroute tableをcontract testで固定する。
- [ ] AC-056-6：`external-change`、`scheduled-task`、`prediction-g3-result`とその他のEventで`peer`を拒否し、既存配送先を変えない。

## Tests

- FR-77, FR-88：構造化出力とTool viewが永続IDを含まず、曖昧なpeer名がno-opになることをunit testで検証する。
- NFR-8, NFR-9：OutboxへActionと配送metadataが原子的に保存され、配送再試行でmentionが重複しないことをintegration / contract testで検証する。
- NFR-10：adapterがmetadataを再検証し、allowlist外への配送を拒否することをcontract testで検証する。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| ADDED | 実装 | `respond.peer`とDiscord peer配送 | `src/` |

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/domain/contracts.ts` | Action schema | 更新する |
| `src/application/agent-runtime.ts` | peer routing / Outbox | 更新する |
| `src/infrastructure/ui/discord-adapter.ts` | mention配送・再検証 | 更新する |
| `src/infrastructure/ui/discord-js-gateway.ts` | delivery context | 更新する |
| `skills/` | `respond.peer`の選択と制約 | 更新する |
| `tests/` | runtime / Discord adapter contract | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `docs/REQUIREMENTS.md` | FR-77 / FR-88 | 反映済み（052） |
| `docs/ARCHITECTURE.md` | ADR-20 / ADR-21 | 反映済み（052） |
