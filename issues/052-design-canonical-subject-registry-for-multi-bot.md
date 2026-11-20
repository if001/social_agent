---
created_at: 2026-11-19
status: done
type: change
plan: []
requirements: [FR-77, FR-82, FR-88, NFR-8, NFR-9, NFR-10, NFR-22]
ui: []
requires: agent
---

# 052 許可済みBot peerのcanonical subjectとDiscord配送を設計する

元計画：#051で除外した複数Bot会話のsubject解決

## Background

#051は単一の現在ユーザーを`user-main`へ正規化する。別Botとの会話をRelationship、Memory subject、Event subjectとして扱うには、許可済みBotのDiscord actor IDとAgent個体を安定して対応づける必要がある。

各Agentは異なるユーザー像・他Bot像を持ち得る。したがってRelationshipとMemoryは既存どおり`agentId`所有に留め、subjectの対応表を全Agent共通の人物・Bot registryにはしない。LLMがcanonical IDやDiscord IDを選択・出力してはならない。

## Dependencies

- 051（単一ユーザーのcanonical subject resolver）

## Scope

- 現在ユーザー`user-main`と、許可済みBot `agent:<agentId>`のcanonical subjectを定義する。
- Agentごとのpeer設定、runtime resolver、Discord受信・配送の境界を定義する。
- 同一human / Botを複数Agentが認識しても、RelationshipとMemoryを共有しない所有境界を定義する。
- LLMにはcanonical IDを公開せず、Runtimeがactor / peer設定 / Event種別から対象を決める経路を設計する。
- subject alias変更・削除・統合、既存Memory / Event / Relationshipのmigrationを設計する。migration専用の監査recordは持たない。
- 未登録Botの無応答、登録済みBotのMemory / Relationship更新、複数候補時のfail-closed規則を定める。
- Botが自発的にpeerへDiscord mentionする`respond`のpeer配送を設計する。

## Out of scope

- #051の`user-main`固定化の実装
- Discord以外の具体的なUI adapter実装
- Subjectを巨大なSocial Graphや共有人物モデルへ拡張すること

## Detailed design

### Subjectと所有境界

- human userは各Agent内で一意の`user-main`とする。`memories.agent_id`、`event_subjects`、`memory_subjects`、`agent_states.relationships`は既存どおりAgent所有なので、shiroとakaのユーザー像・関係は共有しない。
- 許可済みBot peerのsubjectは`agent:<agentId>`とする。例としてshiroのRelationshipは`user-main`と`agent:aka`を持て、akaは独立して`user-main`と`agent:shiro`を持てる。
- subjectは対象を表す。Memoryの`perspective`は`user | self`のままとし、peerとの出来事・peerについてのshiro自身の理解は`self / self-guidance`に、`agent:aka` subjectを付与して保存する。aka自身の視点はaka所有の別Memoryであり、shiroが代理保存しない。
- 生のDiscord IDはEvent / Runと配送metadataの監査用にのみ保持する。Context Builderはそれをmodel-facing actor viewから除き、subject、Relationship、LLM入力・出力には残さない。

### Peer設定とresolver

- peer設定は`config/agent-peers/<botId>.yaml`を各Botのruntime configurationの正本とする。DBへregistry tableを複製しない。設定は`version`、`agentId`、`peers[]`を持ち、各peerは`agentId`、LLM向けの`displayName`、`discordUserId`、自発的送信先の`channelId`を持つ。
- 設定の`agentId`は起動Bot IDと一致しなければならない。peer Agent ID、正規化した表示名、Discord user IDの重複、不正な項目、self参照は起動時に拒否する。channel IDは複数peerで共有できる。
- Runtime-owned resolverは、owner humanを`user-main`へ、allowlistに一意一致するagent actorを`agent:<agentId>`へ解決する。owner外human、未登録Bot、actor不在、複数一致は`undefined`である。
- `actorIdsFor(subjectId)`は、当該Agentのowner IDsまたはpeer設定のDiscord IDだけを返す。各Agentのresolverは別設定で生成する。
- alias変更・削除・統合が必要な場合、明示migrationをdry-run既定で実行し、`--apply`時だけ既存のMemory / Event subjectとRelationshipを新subjectへ置換・重複除去する。専用の監査recordは作らない。

### Discord peer通信

- inbound Discordは、自Botへのmentionを含むowner humanまたはallowlist Botだけを受理する。未登録BotのmessageはEvent・Queue・typingを作らず無視する。
- allowlist Botからの受信では、Discord Adapterが検証済みの`peerAgentId`と`peerDiscordUserId`を非LLM reply metadataとして持つ。Agent Runtimeはそのmetadataを判断せず、応答Outboxへ透過する。Discord Adapterはallowlistを再検証して返信本文へ`<@peerDiscordUserId>`を付与する。
- `respond`は既存の`content`に加え、任意の`peer`（自然言語の`name`と`content`だけ）を持てる。Agent Coreはpeerの自然言語名と本文だけを出し、Runtimeが設定内で一意にpeerを解決してchannel / Discord user IDを配送metadataへ入れる。Discord Adapterがmentionを付ける。canonical ID、Discord ID、local handleはLLMへ公開しない。
- allowlist peer由来Eventでは、`respond.content`を検証済みの受信peerへの返信として配送する。人間の`user-message`では`respond.content`だけを現在ユーザーへ配送し、`peer`を指定できない。
- `idle`と`concern-due`ではFR-76どおり`respond.content`を現在ユーザーへ必ず配送する。`peer`があれば、同一commitで追加のpeer Outboxを作る。peer発話はユーザー発話の置換ではない。
- peer宛先が未設定・曖昧、peerがallowlist外、channelが未設定、又は配送metadata検証に失敗した場合は、Runtimeがpeer Outboxを作らない。`idle` / `concern-due`では正規のユーザーOutboxはそのままcommitし、peer由来Eventでは外部配送を作らない。候補と拒否理由はRunのAction監査に残す。

| Event起点 | `respond.content`の配送先 | `respond.peer` | 不正peer候補 |
|---|---|---|---|
| allowlist peer由来の`user-message` | 検証済みの送信peer | 禁止 | peerへの`content`配送もしない |
| human由来の`user-message` | 現在ユーザー | 禁止 | 該当なし |
| `idle` / `concern-due` | 現在ユーザー | 任意。解決時だけ別peer Outboxを追加 | 現在ユーザーへの配送だけcommit |
| `external-change` / `scheduled-task` / `prediction-g3-result` | Eventが持つ既存の明示配送先だけ | 禁止 | 該当なし |
| それ以外 | 既存のEvent別配送規則 | 禁止 | 該当なし |

## Acceptance criteria

- [x] AC-052-1：`user-main`と`agent:<agentId>`を、Agent所有のMemory / Relationshipと矛盾しないcanonical subjectとして定義する。
- [x] AC-052-2：LLMがcanonical ID、Discord ID、local handleを入出力せず、Runtimeがpeerを一意に解決する経路を定義する。
- [x] AC-052-3：未登録・複数一致・alias変更時のfail-closedとmigration規則を定義する。
- [x] AC-052-4：allowlist Botのmention受信、返信mention、`respond.peer`による自発的peer配送とEvent種別ごとの配送規則を定義する。
- [x] AC-052-5：要件・Architecture・実装Issueへの反映方針を作成する。

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | C-09 / C-18 / C-20に従う。一次仕様の変更は不要 | 不要 |
| `docs/REQUIREMENTS.md` | peer subject、resolver、Discord peer配送 | 反映済み |
| `docs/ARCHITECTURE.md` | peer設定所有・resolver・配送metadata境界 | 反映済み |

## C-17との整合

解消済み。`contact-peer`を追加せず、既存`respond.peer`に自然言語のpeer宛先を伴わせ、
Runtimeが配送先だけを切り替える。C-17の最終Action 4種類を維持する。
