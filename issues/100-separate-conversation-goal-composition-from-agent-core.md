---
created_at: 2026-11-26
status: done
type: change
plan: []
requirements: [C-06, FR-88, FR-90, FR-91, FR-92, FR-94, NFR-8, NFR-21]
ui: []
requires: agent
---

# 100 Conversation Goalの専用生成と配送の分離

元計画：会話で承認したConversation Goal・peer配送の再設計

## Background

Conversation Goalはreply chain内で複数EventにまたがるAgent所有の目的である。
しかし現行はObservation Gateが`engage`とGoal生成を同時に担い、direct peer
入力ではAgent CoreのDesireをGoalへ流用する。さらに`recipient: user`が配送先と
reply metadataの両方を変えるため、会話中のuser発話がreply chainを切り、次の
peer投稿を新規`observed`としてGateへ戻してしまう。

実DBのaka / shiro会話では、akaがGateで作ったGoalの直後にshiroが`recipient:
user`を返し、通常投稿化した。その結果akaの次Event `3f8a7dae-c92f-4d0e-b417-
2e4df8b8ad0` は新規Gate Goalを持った。また既存Conversationに対応するdirect
Eventでも、ContextBuilderが`conversation`をAgent Core入力から落としていた。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | C-06 | Conversation GoalをAgent所有の会話開始時に専用LLMが作る目的として定義する | spec/personal-agent-concept-design-restructured-v2.md |
| MODIFIED | FR-88 | peer発話のreply / mention受理と永続message対応をConversation継続へ使う | docs/REQUIREMENTS.md |
| MODIFIED | FR-90 | human / peerを同一のConversation開始・継続規則で扱う | docs/REQUIREMENTS.md |
| MODIFIED | FR-91 | Observation Gateを`ignore | engage`と理由だけの判定に縮小する | docs/REQUIREMENTS.md |
| MODIFIED | FR-92 | recipientを配送先だけにし、peer targetのreply / mentionをRuntimeが決める | docs/REQUIREMENTS.md |
| MODIFIED | FR-94 | Conversation開始・Goal生成・継続復元・closeの正本を明記する | docs/REQUIREMENTS.md |
| MODIFIED | NFR-21 | Goal Composerを軽量LLM callとして予算・監査する | docs/REQUIREMENTS.md |

## 影響範囲

検索した語：`Conversation Goal`、`conversationGoal`、`Observation Gate`、
`recipient`、`peer/direct`、`peer/observed`、`conversations`、
`conversation_messages`、`replyContext`。

| 場所 | 内容 | 対応 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md | C-06のConversation Goal定義 | 更新する |
| spec/personal-agent-implementation-design-v2.md | Conversation / Action詳細設計 | 更新する |
| docs/REQUIREMENTS.md | FR-88, FR-90, FR-91, FR-92, FR-94, NFR-21 | 更新する |
| docs/ARCHITECTURE.md | ADR-21, ADR-24, ADR-26と実行境界 | 更新する |
| docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md | 社会的入力・通常会話フロー | 更新する |
| docs/TEST_STRATEGY.md | FR-94のGoal生成・継続配送テスト | 更新する |
| src/application/observation-gate.ts | Gate出力契約 | 更新する |
| src/application/agent-runtime.ts | Goal Composer呼出、Conversation帰属、配送選択 | 更新する |
| src/application/context-builder.ts | active Conversation Goalの入力維持 | 更新する |
| src/infrastructure/agent/* | Goal Composerの軽量JSON呼出 | 更新する |
| src/infrastructure/ui/discord-adapter.ts | peer mention / replyの配送と受理 | 更新する |
| src/infrastructure/persistence/*conversation* | Goalとmessage対応の永続化 | 更新する |
| tests/ | unit / contract / system / integration / live検証 | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md C-06 | Goal作成者と配送からの独立 | 反映予定（本会話で承認済み） |
| spec/personal-agent-implementation-design-v2.md | Conversation / Action詳細設計 | 反映予定 |
| docs/REQUIREMENTS.md | 会話開始・継続・配送規則 | 反映予定 |
| docs/ARCHITECTURE.md | ComposerとRuntime / Adapter境界 | 反映予定 |
| docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md | Eventフロー | 反映予定 |
| docs/TEST_STRATEGY.md | 検証対応 | 反映予定 |

## Dependencies

- なし

## Scope

- Observation Gateを`ignore | engage`と理由だけの軽量判定にする。
- ConversationGoalComposerを、Agent Coreとは独立した小さなJSON LLM callとして実装する。
- 観測投稿へのengage、対応のないhuman / peer direct、及び自律peer開始でComposerを使う。
- 継続Conversationでは保存済みGoalだけをContext Builder経由でAgent Coreへ渡す。
- `respond.recipient`を`user | channel | peer`として配送先だけを表す。
- `peer`はRuntime束縛済みの同一peerの入力投稿があればreply、なければPeerInitiationGateが一意に解決したallowlist peerへのmentionにする。
- Conversationに属するoutboundはrecipientに関係なく同じConversation対応を永続化する。
- human / peerの各Agentは相手のGoalを共有せず、自分のGoalを保持する。

## Out of scope

- Conversationの長期履歴を初期Contextへ追加すること。
- 複数recipient、複数本文、Bot間のbroadcast配送。
- Concern、Memory、Relationshipの別モデル化。
- 既存Conversation Goalの内容をLLMで一括再生成するmigration。

## Implementation notes

- ComposerはID、recipient、Action、状態更新を出力せず、短い`goal`だけをJSONで返す。
- peer観測はGateが`engage`した後だけComposerを呼ぶ。directの既存対応表解決ではComposerを呼ばない。
- 自律peer開始はPeerInitiationGateが自然言語のpeer表示と開始理由を返し、Runtimeがallowlistから一意に束縛してからComposerを呼ぶ。Composer GoalをAgent Coreへcandidateとして渡し、実際に当該peerへ配送した時だけConversationを開始する。
- 既存Conversationで`recipient: user`又は`channel`を選んでもGoalをclose・置換しない。
- `recipient: peer`のtargetはRuntimeがallowlist・Event発話元・Discord metadataから検証し、Agent CoreはAgent ID、Discord ID、local handleを出力しない。

## Acceptance criteria

- [x] C-06：Conversation GoalはDesireから流用せず、開始Agentごとの専用Composerが作る。
- [x] FR-91：Observation Gateはengage判断と理由だけを返し、Goalを返さない。
- [x] FR-94：継続replyは保存済みのAgent所有GoalをAgent Coreへ渡し、再生成しない。
- [x] FR-90：botAとbotBは同じreply chainで別々のAgent所有Goalを持てる。
- [x] FR-92：`recipient`は配送先だけを表し、`user` / `channel`で既存Conversationを切らない。
- [x] FR-88, FR-92：`peer`は既存入力へのreply又は自律開始時のallowlist peer mentionとして配送される。
- [x] NFR-21：Composer callの入力・出力・call数・失敗が監査され、失敗時に通常Agent Coreを不正なGoalで開始しない。
- [x] 差分が正の文書に反映されている。
- [x] 上流への反映がすべて反映済み又は不要になっている。
- [ ] `spec-analyze change`でCRITICALとHIGHの指摘がない。

## Tests

- C-06：ComposerはAgent Core出力を使わず、短いGoalだけを生成する。
- FR-91：Gateのengage / ignore出力にGoalが存在しない。
- FR-94：再起動後を含むreply chainで同じAgentのGoalがContext BuilderからAgent Coreへ渡る。
- FR-90：peer Aとpeer Bは同じDiscord連鎖でも各Agent所有の異なるGoalを保持できる。
- FR-92：会話中の`recipient: user`及び`channel`がConversation対応を保持する。
- FR-88, FR-92：PeerInitiationGateが自然言語候補から一意に束縛したpeer targetは、reply起点ありではreply、起点なしではallowlist mentionとなる。
- NFR-21：Composerのschema / provider失敗は監査し、Conversationを開始しない。
