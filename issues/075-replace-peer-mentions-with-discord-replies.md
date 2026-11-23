---
created_at: 2026-11-23
status: done
type: change
plan: []
requirements: [FR-76, FR-88, FR-92, FR-94, NFR-8, NFR-9]
ui: []
requires: agent
---

# 075 Bot間mentionを廃止しDiscord replyへ統一する

起点：Bot間会話は通常投稿へのreplyで開始・継続し、BotがBotへmentionしない方針を採用したが、FR-92・ADR-24・Runtime・Discord Adapterにはpeer名をmentionへ変換する旧設計が残っていた。

## Scope

- Bot間発話は、現在処理中のallowlist peer投稿のDiscord message IDへreplyする。
- `recipient`省略はEvent発話元へのreply、`channel`は非mention通常投稿、`user`はowner user向けとする。
- peer表示名を`recipient`へ指定して新規mentionする経路をschema、skill、Runtime、Adapterから除く。
- 自律Eventから特定Botへ直接発話せず、`channel`への通常投稿をpeerが観測し、自身の動機でreplyすることで会話を開始する。
- reply対象がない場合、Bot mentionへフォールバックしない。
- 要件、一次設計、Architecture、Event overview、Test Strategyへ反映する。

## Out of scope

- human ownerへのmention方式の変更
- Discordの過去投稿を検索して任意のBot投稿へreplyする機構
- 送信済みOutboxの書き換え

## Acceptance criteria

- [x] Botのpeer投稿への応答はDiscord replyとなり本文にBot mentionを含まない。
- [x] peer名を`recipient`へ指定する構造出力はschema検証で拒否される。
- [x] `channel`は非mention通常投稿を維持する。
- [x] reply対象がない自律EventからBot mentionを生成しない。
- [x] 正の文書、skill、schema description、Runtime、Adapter、testが同じ境界を表す。
- [x] `pnpm verify`が成功し、独立レビューと`spec-analyze change`にCRITICAL / HIGHがない。

## Tests

- FR-88, FR-92：peer observed / directへの応答がsource messageへのreplyとなりmentionを含まないcontract / system test。
- FR-92：`recipient: peer表示名`をAction schemaが拒否するunit test。
- FR-76, FR-92：`recipient: channel`だけがreplyなし通常投稿を作るsystem test。
- NFR-8, NFR-9：旧`payload.peer`を受けてもAdapterがmentionへ変換しないcontract test。

## 上流への反映

- `spec/personal-agent-concept-design-restructured-v2.md`、`spec/personal-agent-implementation-design-v2.md`：反映済み。
- `docs/REQUIREMENTS.md`、`docs/ARCHITECTURE.md`、Event overview、Test Strategy：反映済み。

## 実装メモ

- `respond.recipient`は`user | channel`だけとし、省略時は現在の発話元投稿へreplyする。Bot名はschemaで拒否する。
- peer Eventから`recipient: user`を選んだ場合は、Runtimeが設定済みowner IDをtransport metadataへ解決し、Discord Adapterだけがowner mentionを生成する。LLMにはDiscord IDを扱わせない。
- Conversationは`replyContext.messageId`を持つ実際のreplyでのみ開始する。非mention channel投稿はConversationを開始しない。
- 旧Outboxの`payload.peer`は読み取り互換だけ残し、AdapterはBot mentionへ変換しない。
- 検証：`pnpm verify`（unit 282、integration 70、system 64、evaluation 15）成功。ID検査はERROR 0、今回変更IDの新規WARN 0（既存WARN 8）。
- 独立レビュー：`docs/work/reviews/2026-11-23-issue-075.md`。
- spec-analyze change：`docs/work/analyze/2026-11-23-change-075.md`。
