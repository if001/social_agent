---
created_at: 2026-10-03
status: created
---

# 034: Discord入力を対象botへのメンションで振り分ける

## Background

現在のDiscord Adapterは、allowlistに含まれるユーザーが許可チャンネルへ投稿すると、メンションの有無に関係なく入力をAgentへ配送する。同じチャンネルで複数botを起動すると全botが同じ投稿へ応答し、botが送信した投稿は一律に除外されるため、bot Aからbot Bへのメンションも処理できない。

期待する動作は、ユーザーまたは別botの投稿に対象bot自身へのDiscordメンションが含まれる場合だけ、そのbotが反応することである。メンションがない投稿と、別のbotだけをメンションした投稿は処理しない。

## Scope

- `DISCORD_BOT_USER_ID`をDiscord Adapterへ渡し、`<@BOT_USER_ID>`と`<@!BOT_USER_ID>`を厳密に判定する。
- Guild、thread、DMを含め、対象botへのメンションが存在する投稿だけをAgent Queueへ配送する。
- 人間の投稿には既存のowner／guild／channel allowlistを適用する。
- bot自身の投稿は無視し、別botから対象botへのメンションは受理する。
- Agentへ渡す本文から対象botのメンション表記を除去し、前後の空白を正規化する。
- メンションだけの投稿を処理する場合のObservation用本文を明示的に定義する。
- 複数botが同じチャンネルを購読しても、メンションされたbotだけにEventが作られることを検証する。
- `docs/ARCHITECTURE.md`、`docs/REQUIREMENTS.md`、`docs/MANUAL_SMOKE.md`へメンションルーティング仕様を反映する。

## Out of scope

- Discord slash commandやprefix commandの追加。
- Discord roleメンション、`@everyone`、`@here`への反応。
- Agentがいつ別botをメンションするかというLLMの行動方針。
- Discord以外のQueue上で行う`agent_send`通信方式の変更。

## Implementation notes

- authorが人間かbotかにかかわらず、最初に対象bot自身へのメンションを確認する。
- `isBot=true`かつ`authorId`が対象bot自身の場合は循環防止のため拒否する。別botの投稿は、対象メンションとguild／channel allowlistを満たす場合に受理する。
- 人間のauthorだけを`DISCORD_OWNER_IDS`で制限する。bot間メンションに人間用owner allowlistを流用しない。
- メンション判定は部分一致を避け、Discordのuser mention形式をescapeした正規表現または構造化mention情報で処理する。
- このIssue完了後に2 botのManual Smoke（Issue 033）を実施する。

## Acceptance criteria

- [ ] ユーザーがbot Aだけをメンションすると、bot Aだけが入力Eventを作成する。
- [ ] bot Aがbot Bだけをメンションすると、bot Bだけが入力Eventを作成する。
- [ ] メンションがない投稿では、どのbotも入力Eventを作成しない。
- [ ] 別botだけをメンションした投稿を対象外botが処理しない。
- [ ] 対象bot自身の投稿による自己応答loopが発生しない。
- [ ] owner、guild、channelの既存allowlistが意図したauthor種別に適用される。
- [ ] Agentへ渡す本文に対象botの生メンションIDが残らない。

## Tests

- Discord Adapter contract testで通常メンション、nickname形式、メンションなし、別botメンション、自己投稿を検証する。
- 2つのDiscord Adapterを同じfake gateway／channelで動かし、対象botだけにQueue messageが作られるsystem testを追加する。
- bot Aからbot Bへのメンションと自己応答防止をsystem testで検証する。
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:system`

## Dependencies

- 032

## Plan reference

- [Implementation Plan: Discord UI Adapter](../docs/IMPLEMENTATION_PLAN.md)
- [Architecture: Discord Adapter／複数bot](../docs/ARCHITECTURE.md)
- [Manual Smoke](../docs/MANUAL_SMOKE.md)
- 033の実施前提
