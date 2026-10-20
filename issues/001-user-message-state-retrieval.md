---
created_at: 2026-10-19
status: done
type: change
plan: []
requirements: [C-04, C-06, C-07, C-11, FR-33]
requires: agent
---

# 001 user-messageではself_getを許可し、Concern系Toolを背景Eventへ分離する

元計画：なし（会話起点）

## Background

user-messageでは`self_get`、`concern_list`、`concern_get`がmiddlewareで非表示になっている（[deep-agent-middleware.ts](../src/infrastructure/agent/deep-agent-middleware.ts#L32-L38)）。一方、`concern_propose`はuser-messageでも表示されている。

ユーザー判断により、user-messageの役割を次のように固定する。

- user-messageでは、現在のEvent、Self、Memory、Relationship、MoodからDesireを形成する。
- 現在のMood、Commitments、Self Storyは`self_get`で取得する。
- 既存Concernへの接続とConcern作成は行わない。`concern_list`、`concern_get`、`concern_propose`はuser-messageでは使わない。
- Concernの作成はidle / concern-dueへ任せる。既存Concernの整理・統合・終了はReflectionの既存責務を維持する。

`previousDesire`の入力追加とDesireの引き継ぎはIssue 002で扱う。

## Dependencies

なし

## Scope

- `user-message`のmiddleware filterで`self_get`を許可し、`concern_list`、`concern_get`、`concern_propose`を非表示にする。
- 非表示Toolがモデルから直接呼ばれても実行せず、`TOOL_NOT_AVAILABLE`のTool failureとして同じloopへ返す。
- system promptへuser-messageの境界を1箇所追加する。
  - 必要に応じて`self_get`でMood / Commitments / Self Storyを確認する。
  - Concernの取得・作成は行わない。
- user-messageのTool可視性testを新しい契約へ更新する。
- 上記のprompt修正をこのIssue内で行う。
- user-messageのConcern非取得・非作成を一次ドキュメントへ反映する。
  - `spec/personal-agent-concept-design-restructured-v2.md` C-06へuser-messageの例外を追記する。
  - `spec/personal-agent-implementation-design-v2.md` §12、§13、§18へ同じ例外を追記する。

## Out of scope

- user-messageで既存Concernへ接続すること。
- user-messageでConcernを作成すること。
- `previousDesire`の入力追加、Desireの引き継ぎ、Reflectionによる新規Concern作成。Issue 002で扱う。
- Context BuilderへのMood / Concern / Commitmentsの常時投入。
- 新しい`state_snapshot_get`Toolの追加。
- `concern_propose`をuser-message以外で制限すること。
- 「あとで調べる」の強制ルーティング。
- 外部skillローダーの新設。

## 変更不要と確認したもの

- `self_get`のdescriptionは、すでにDisposition、Self Story、Commitments、Moodの取得を説明している。user-message固有の文言追加は不要。
- `concern_list` / `concern_get` / `concern_propose`のdescriptionは、自律Event・Focus選択・run-local提案の用途を説明している。user-messageでは非表示にするため、description変更は不要。
- `focusConcernAcquired`後の`concern_list` / `concern_get`抑制は既存動作。維持する。
- `tests/integration/persistence.test.ts`の`availableTools`一覧は、middleware前のRegistry内容を見ているため変更しない。
- Context Builderの予算と`AgentCoreInput`は変更しない。Mood / Commitments / Concernを初期Contextへ追加しない。

## Implementation notes

- `deep-agent-middleware.ts`の`eventKind === "user-message"`分岐を、`["concern_list", "concern_get", "concern_propose"]`を非表示にする形へ変更する。`self_get`は許可する。
- `wrapToolCall`にも同じ境界を置き、非表示Toolの直接呼び出しを実行せず`TOOL_NOT_AVAILABLE`として記録する。
- `deep-agent-prompt.ts`のuser-message向け判断規則へ、`self_get`の利用とConcern系Toolを使わないことを短く追加する。自律Eventの`concern_list`指示は変更しない。
- `tests/system/tool-loop.test.ts`のuser-message期待値を、`self_get`を含み、`concern_list` / `concern_get` / `concern_propose`を含まない形へ更新する。
- `tests/unit/agent-prompts.test.ts`へ、user-messageのConcern非取得・非作成境界のprompt testを追加する。
- 既存の`focusConcernAcquired`testはそのまま維持する。

## Acceptance criteria

- [x] AC-5：user-messageのAgent Core実行で`self_get`が公開され、`concern_list`、`concern_get`、`concern_propose`は公開されない。直接呼ばれても実行されない。promptが`self_get`利用とConcern非取得・非作成を説明する。
- [x] user-messageでは`concern_list`、`concern_get`、`concern_propose`が利用できず、直接呼ばれても実行されない。
- [x] idle / concern-dueでは従来どおりConcern系Toolが利用できる。
- [x] promptにuser-messageのConcern非取得・非作成境界がある。
- [x] user-messageのTool可視性testが新しい契約になっている。
- [x] 差分が正の文書に反映されている。
- [x] 上流への反映がすべて「反映済み」または「不要」になっている。
- [x] `spec-analyze change`でCRITICALとHIGHの指摘がない。

## Tests

- FR-33：user-messageのmiddlewareが`self_get`を露出し、`concern_list`、`concern_get`、`concern_propose`を露出しない。
- FR-33、AC-5：user-messageで非表示Toolを直接呼んでも実行せず、`TOOL_NOT_AVAILABLE`を返す。
- FR-33：idle / concern-dueでは`concern_list`、`concern_get`、`concern_propose`を露出する。
- FR-33：`focusConcernAcquired`後は`concern_list`と`concern_get`を抑制する（既存test維持）。
- FR-33、AC-5：promptがuser-messageのConcern非取得・非作成を説明する。
- typecheck、lint、関連system test。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | C-06 | user-messageでは保存済みConcernの取得・作成を行わず、Event、Self、Memory、Relationship、MoodからDesireを形成する | spec/personal-agent-concept-design-restructured-v2.md |
| MODIFIED | （IDなし）§12、§13、§18 | user-messageのConcern非取得・非作成、Desire形成、Tool公開境界 | spec/personal-agent-implementation-design-v2.md |
| MODIFIED | FR-33 | Event種別に応じて公開するToolを制限する。user-messageでは`self_get`を許可し、Concern系Toolを公開せず、直接呼ばれても実行しない | docs/REQUIREMENTS.md |
| ADDED | AC-5 | user-messageの`self_get`利用、Concern系Tool非公開、直接呼び出しの非実行を検証する | docs/REQUIREMENTS.md |


## 影響範囲

検索した語：`self_get`、`concern_list`、`concern_get`、`concern_propose`、`user-message`、「自律Event」、「Tool」

| 場所 | 内容 | 対応 |
|---|---|---|
| src/infrastructure/agent/deep-agent-middleware.ts | user-messageのTool非表示 | 更新する |
| src/infrastructure/agent/deep-agent-prompt.ts | user-messageの取得・作成境界 | 更新する |
| tests/system/tool-loop.test.ts | user-messageのTool可視性test | 更新する |
| tests/unit/agent-prompts.test.ts | prompt境界test | 追加する |
| docs/AGENT_MOTIVATION_MODEL.md | user-messageのTool取得境界 | 更新する |
| docs/REQUIREMENTS.md | FR-33、AC-5 | 更新する |
| docs/ARCHITECTURE.md | Event種別ごとのTool公開 | 更新する |
| docs/TEST_STRATEGY.md | Tool可視性の検証対応 | 更新する |
| src/infrastructure/tools/agent-context-tools.ts | Tool description | 変更しない（既存説明で足りる） |
| src/infrastructure/agent/deep-agent-harness.ts | 初期promptInput | 変更しない |
| tests/integration/persistence.test.ts | Registryの`availableTools` | 変更しない |
| spec/personal-agent-concept-design-restructured-v2.md | C-06 | 更新する |
| spec/personal-agent-implementation-design-v2.md | §12、§13、§18 | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md C-04 | 状態を主観的意味に使う | 不要 |
| spec/personal-agent-concept-design-restructured-v2.md C-06 | user-messageでは保存済みConcernの取得・作成を行わない例外 | 反映する（ユーザー承認済み 2026-10-21） |
| spec/personal-agent-concept-design-restructured-v2.md C-07 | Moodを複数Eventへ影響する背景気分とする | 不要 |
| spec/personal-agent-concept-design-restructured-v2.md C-11 | 好奇心と関係性をDesire / Concernへつなげる | 不要 |
| spec/personal-agent-implementation-design-v2.md §12 | user-messageのConcern非取得・非作成 | 反映する |
| spec/personal-agent-implementation-design-v2.md §13 | user-messageのDesire形成 | 反映する |
| spec/personal-agent-implementation-design-v2.md §18 | user-messageで公開しないTool | 反映する |
| docs/AGENT_MOTIVATION_MODEL.md | user-messageのTool境界 | 反映する |
| docs/REQUIREMENTS.md | FR-33、AC-5 | 反映する |
| docs/ARCHITECTURE.md | Event種別ごとのTool公開 | 反映する |
| docs/TEST_STRATEGY.md | 検証対応 | 反映する |

## 実装メモ

- `deep-agent-middleware.ts`のuser-message filterを`concern_list`、`concern_get`、`concern_propose`の非表示へ変更し、`self_get`を許可した。`wrapToolCall`でも同じToolを拒否し、実行しない。
- `deep-agent-prompt.ts`へuser-messageの取得・作成境界を1文追加した。
- `tests/system/tool-loop.test.ts`でuser-messageの可視Toolと、idle / concern-dueのConcern系Tool公開、Focus取得後の抑制を確認した。
- `tests/unit/agent-prompts.test.ts`でprompt境界を確認した。
- 一次ドキュメント`spec/personal-agent-concept-design-restructured-v2.md` C-06と`spec/personal-agent-implementation-design-v2.md` §12、§13、§18を更新した。
- 正の文書`docs/AGENT_MOTIVATION_MODEL.md`、`docs/REQUIREMENTS.md`、`docs/ARCHITECTURE.md`、`docs/TEST_STRATEGY.md`を更新した。
- 検証: typecheck、lint、unit 141件、system 41件、evaluation 14件、integration persistence 25件が通過。integration `reset-runtime`は`POSTGRES_URL`未設定で実行不能。
- レビュー記録: [docs/work/reviews/2026-10-21-issue-001.md](../docs/work/reviews/2026-10-21-issue-001.md)
