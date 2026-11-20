---
created_at: 2026-11-21
status: done
type: change
plan: []
requirements: [FR-16, FR-33, FR-47, FR-48, FR-59, FR-76, FR-77, FR-82, FR-88, FR-90, NFR-1, NFR-8, NFR-9, NFR-10, NFR-18]
ui: []
requires: agent
---

# 061 人間・peerを統合する`message-received` Eventを設計する

## Background

人間とBot peerは、ともに「他者からの社会的な入力」であり、同じAgentがAssessment、Feeling、Desire、Action、Experience Integrationを通じて意味づける。一方で、現在の`user-message`は人間固有のTool制限・優先度・配送規則を抱え、allowlist peerのmentionを`external`へ落とすため、peerとの会話と観測可能な独り言を自然な社会経験として扱えない。

`user-message`を単に一般化すると、既存の人間専用規則と履歴との意味が曖昧になる。新規入力の正本を`message-received`とし、`user-message`は既存履歴の読取り互換に限定する設計を文書化する。

## Dependencies

- 052
- 055
- 060

## Scope

- Event入力を`message-received`へ統合し、モデルに渡す意味情報を`senderKind: human | peer`、`addressing: direct | observed`、本文、自然言語の相手表示名に限定する。Discord ID、canonical ID、actor ID、channel/reply metadataはRuntime監査だけに置き、LLMへ渡さない。
- Runtimeの受理規則を固定する。
  - owner humanが自Botへmentionした投稿は`human/direct`。
  - allowlist peerが自Botへmentionした投稿は`peer/direct`。
  - allowlist peerの同一観測channelへの非mention投稿は`peer/observed`。
  - self、allowlist外Bot、owner外humanはEventを作らない。
  - direct投稿をobservationとして二重作成しない。
- 共通の認知loopは分けず、interactionに応じたskill / Tool / 配送規則だけを分ける。最小のsystem promptにはEvent固有の本文を置かず、`social-message`、`human-direct-message`、`peer-direct-message`、`peer-observation` skillへ移す。
- ConcernはAgent所有の共通モデルとし、人間用／peer用に分割しない。Runtimeが入力起点または一意に解決した自然言語peer名から`user-main`又は`agent:<peer>`との論理的関連を付与する。LLMはIDを出力しない。
- RelationshipはAgent-localかつ対象ごとに持つ。peer Memoryは「peerの客観的事実」ではなく「当該Agentがpeerの発言をどう受け取ったか」というAgent所有の経験として保存する。
- Action配送を固定する。
  - human/directの`respond.content`は人間への返信。
  - peer/directの`respond.content`はsource peerへのmention返信。
  - peer/observedの`respond.content`は共有channelへの非mention発話であり、返信義務はない。
  - idle / concern-dueの`respond.content`は共有channelへの自発発話。任意の`respond.peer { name, content }`は一意なallowlist peerへのmention。
  - Runtimeだけが宛先・Discord ID・channelを解決し、Adapterは現行allowlistで再検証する。
- `RUNTIME_MAX_HOPS`を因果循環だけを止める機械的制約として維持する。連投、応答待ち、社会的な遠慮を抑制規則にしない。
- `FR-16 / FR-33 / FR-47 / FR-59 / FR-76 / FR-77 / FR-82 / FR-88 / NFR-1 / NFR-8 / NFR-9 / NFR-10 / NFR-18`、`docs/ARCHITECTURE.md`、`docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md`、関連skill契約を上記の正本へ更新する。旧#056はこの設計の実装Issueへ置換する扱いを明記する。

## Out of scope

- allowlist外Bot又は複数人ユーザーの受理
- Discord以外のpeer配送
- peerごとの別Agent Core、別Concern lifecycle
- peer投稿の全量をMemoryへ保存すること

## Acceptance criteria

- [x] AC-061-1：新規の社会的受信は`message-received`を正本とし、`user-message`は履歴互換の読取り以外に使わないことが要件・Architectureに明記される。
- [x] AC-061-2：human/direct、peer/direct、peer/observedの受理、モデルview、Tool公開、配送、Memory / Relationshipの差がroute tableとして文書化される。
- [x] AC-061-3：Concernが相手種別ではなくAgentの動機に属し、人間・peer・自己・世界へ関連し得ること、関連subjectはRuntimeが解決することが明記される。
- [x] AC-061-4：peer観測は返信義務を持たない一方、Memory、Relationship、Mood、Concern形成の材料になり得ることが明記される。
- [x] AC-061-5：LLMのID-free境界、allowlist、self拒否、二重Event防止、hop制限、Outbox原子性、Adapter再検証が要件に残る。
- [x] AC-061-6：既存#056との重複を解消し、実装は後続#062へ一本化する。

## Tests

- 実装Issueで、受理route table、skill / Tool公開、ID-free model view、Memory / Relationshipの所有権、Outbox配送、allowlist再検証、hop / dedupをcontract / integration testする。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-16, FR-33, FR-47, FR-59, FR-76, FR-77, FR-82, FR-88 | 社会的受信を`message-received`へ統合し、interaction別policyを規定 | `docs/REQUIREMENTS.md` |
| MODIFIED | NFR-1, NFR-8, NFR-9, NFR-10, NFR-18 | 所有権、原子配送、再試行、hop、優先度の対象を更新 | `docs/REQUIREMENTS.md` |
| MODIFIED | ADR / route table | Runtime、Context、skill、Outbox、Discord Adapterの責務を更新 | `docs/ARCHITECTURE.md` |
| MODIFIED | Event overview | 社会Eventのライフサイクルを追記 | `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` |

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| `docs/REQUIREMENTS.md` | Event、skill、Tool、配送、経験統合要件 | 更新する |
| `docs/ARCHITECTURE.md` | Event ingressとsocial route table | 更新する |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | 人間／peer受信と配送の概要 | 更新する |
| `skills/` | 共通・human direct・peer direct・peer observationの契約 | 更新方針を定義する |
| `issues/056-*.md` | 重複した旧配送計画 | #062へ置換する方針を記録する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | C-09 / C-16 / C-17が同じAgent Loopと他Agent Messageをすでに規定するため変更不要 | 不要 |
| `docs/REQUIREMENTS.md` | FR-1 / 16 / 33 / 48 / 59 / 76 / 82 / 88 / 90、NFR-18、ACを更新 | 反映済み |
| `docs/ARCHITECTURE.md` | Event ingress、priority、Context、G1/G2、Outbox責務を更新 | 反映済み |
| `docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md` | 社会的入力・配送route tableを追記 | 反映済み |
| `docs/AGENT_MOTIVATION_MODEL.md` | 共通Loop、Tool境界、予測対象を更新 | 反映済み |

## 実装メモ

- `message-received`は社会的入力の正本であり、humanとpeerでConcernや認知pipelineを分けない。
- direct入力だけが相手からの次ターン予測と応答義務を持つ。peer/observedは共通Loopへ入るが、返信義務とG1/G2対象を持たない。
- #056は配送だけを切り出した旧計画のため`stop`とし、#062に統合した。
- `trace_check.py --root .`はERROR 0件。既存要件を含むWARN 9件のうち、FR-90の未テストは#062で解消する。
- レビュー記録：`docs/work/reviews/2026-11-21-issue-061.md`。
