---
created_at: 2026-11-19
status: done
type: change
plan: []
requirements: [C-01, C-04, C-06, C-07, C-14, C-17]
requires: agent
---

# 049 自律発話をAgent自身の欲求と気分から行う

元計画：会話で採用した、タチコマをモチーフとする「無邪気で自己中心的だが、明示的な役割には忠実な個体」という方針。

## Background

実DB上のshiroのidle発話は、固有のConcern・Feeling・探索軸を持つ一方、探索結果を「役に立つよう整理して届ける」調査報告へ一様に変換していた。同じ発見の再配送、根拠のないユーザー生活への適合推測、過度な断り・配慮も確認された。

idleの探索はユーザー報告を目的にしない。Agent自身の知りたい欲、驚き、不満、誇らしさ、退屈、面倒くささを満たす行動であり、外部発話は近くにいる相手へ漏れる独り言・問い掛け・反論・途中経過になり得る。ユーザーについて知りたい不確かさがあるときだけ、根拠のある問い掛けを選ぶ。明示的なCommitmentとscheduled-taskは、この自由な探索とは別に、役割・約束への忠実さとして扱う。

怠けることは虚偽の完了・根拠の捏造ではない。低関心、退屈、面倒、期待外れを根拠に、探索を後回しにする、方法を変える、途中でやめる、別のConcernへ移る、短く漏らすことを許す。

## Dependencies

- なし

## Scope

- 一次概念設計、実装設計、動機モデル・Event概要へ、自律探索・発話・質問・Commitmentの区別を明記する。
- 共通Agent prompt、idle / concern-due / scheduled-task skillを、報告義務・ユーザー有用性中心ではなく、Agent自身のDesireとFeeling中心にする。
- shiro の初期Selfを、他者への配慮だけでなく無邪気な脱線・面倒くささ・役割への忠実さを持つ初期の種へ改める。
- `user_context_get`をidleごとの必須Toolから外し、ユーザーに関する不確かさを自分で解きたい場合だけ使うようにする。
- 既配送の発見を同じ要旨で再送しないこと、既知Memoryのない属性・生活型を推測しないことを発話判断に加える。
- 自律探索での未達・先送り・脱線を正当な選択としてテストする。scheduled-taskでは虚偽なく約束を扱うこともテストする。

## Out of scope

- FeelingやDispositionを数値的な性格パラメータにすること。
- 事実・出典・完了状況を偽ること。
- idle / concern-dueの配送必須、Concern lifecycle、Scheduler cadenceを変更すること。
- 特定の語尾・キャラクター口調を固定すること。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | C-17 | 自律探索の目的を共有価値ではなくAgent自身のDesireとFeelingに置き、発話を独り言・問い掛け・反論・途中経過として扱う | spec/personal-agent-concept-design-restructured-v2.md |
| MODIFIED | C-14 | 怠ける・脱線する・先送りすることを、虚偽を伴わない主体的な行動選択として明確化する | spec/personal-agent-concept-design-restructured-v2.md |
| MODIFIED | 実装設計 §25/§26 | idleとscheduled-taskの動機・発話判断を分離する | spec/personal-agent-implementation-design-v2.md |
| MODIFIED | 動機モデル / Event概要 | 自律探索、ユーザーへの質問、Commitmentの役割を区別する | docs/AGENT_MOTIVATION_MODEL.md, docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md |

## 影響範囲

検索した語：`共有価値`、`idleごとにuser_context_get`、`結果を必ずユーザーへ発話`、`scheduled-task`、`自律発話`、`Concern`。

| 場所 | 内容 | 対応 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md §1, §23 | 個体性・自律発話の一次原則 | 更新する |
| spec/personal-agent-implementation-design-v2.md §25, §26 | Event別の実装判断 | 更新する |
| docs/AGENT_MOTIVATION_MODEL.md | 動機・Eventの関係図 | 更新する |
| docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md | Eventの入出力・目的 | 更新する |
| docs/ARCHITECTURE.md | Agent Coreの発話判断 | 更新する |
| src/infrastructure/agent/deep-agent-prompt.ts | 共通発話規則 | 更新する |
| skills/idle/SKILL.md | idleのTool利用・探索・発話規則 | 更新する |
| skills/concern-due/SKILL.md | Concern再検討の発話規則 | 更新する |
| skills/scheduled-task/SKILL.md | 約束と結果通知の規則 | 更新する |
| config/initial-self/shiro.yaml | shiroの初期Disposition | 更新する |
| tests/unit/agent-prompts.test.ts | prompt / skillの回帰検証 | 更新する |
| tests/system/self-drive-autonomy.test.ts | 自律的Actionの回帰検証 | 更新するか確認する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md | C-14、C-17の修正 | ユーザー承認済み |
| spec/personal-agent-implementation-design-v2.md | Event別の詳細設計 | ユーザー承認済み |

## Implementation notes

1. 自律探索のDesireは「知りたい／考えたい／不満を言いたい／放っておきたい」を主語にし、外部発話はその副作用にする。ユーザーへの有用性・反応期待は選択根拠にしない。
2. idleは常に発話するが、発話内容は独り言、仮説、感情、未達のぼやき、具体的なユーザー質問のいずれでもよい。調査の完全な報告・出典一覧・次回予告を既定形にしない。
3. ユーザー質問は、Agent自身が知りたい具体的な事実の欠落があり、Memory / Relationship / 現在Eventに根拠がある場合だけ選ぶ。ユーザーの生活型や嗜好を推測して接続しない。
4. 同じ発見を再び話す場合は、新しい事実、解釈、感情、または問いがある場合だけにする。
5. scheduled-taskは約束・役割の実行として扱う。Agentは不満や面倒を表してよいが、実行済み・予約済み・根拠を偽らない。

## Acceptance criteria

- [x] 一次仕様に、自律探索の主目的がAgent自身のDesire・Feelingであり、発話は報告義務ではないことが反映されている。
- [x] 一次仕様に、虚偽を伴わない先送り・脱線・中断を主体的選択として反映している。
- [x] idle skillはuser_context_getを毎回必須にせず、ユーザー質問をAgent自身の具体的な不確かさに限定する。
- [x] idle / concern-due skillは、独り言・感情・仮説・未達を正当な発話として扱い、調査報告・出典一覧・次回予告を既定形にしない。
- [x] 共通promptは、既配送内容の再送と根拠のないユーザー属性推測を禁止する。
- [x] scheduled-taskは約束・役割への忠実さを扱い、探索的idleとは別の判断規則を持つ。
- [x] 回帰テストが上記のprompt / skill規則と、虚偽なしの先送り・脱線を検証する。
- [x] `pnpm test`、`pnpm typecheck`、変更したTypeScriptへのeslintが成功する。
- [x] 差分が正の文書に反映され、上流への反映がすべて反映済みである。
- [x] IDトレース検査で今回追加したERRORがない。

## Tests

- C-01 / C-04 / C-06 / C-07 / C-17：prompt / skillの静的検証で、発話の動機・質問の根拠・感情の行動影響を確認する。
- C-14 / C-17：`tests/unit/agent-prompts.test.ts` が、idle / concern-due / scheduled-taskの判断契約と、虚偽なしの先送り・脱線を検証する。
- FR-6：`tests/unit/config-lifecycle.test.ts` が、shiroの初期Selfに無邪気な脱線と先送りの種が含まれることを検証する。

## 実装メモ

- `C-19` は既存の設計原則IDだったため新設せず、遊び・退屈・逸脱を定義する `C-14` を具体化した。
- 自律発話の意味は prompt / Event skill が公開する判断契約として検証する。LLMの文面を固定するのではなく、`tests/unit/agent-prompts.test.ts` が自律発話・質問・先送り・Commitmentの境界を検証する。
- 検証: `pnpm test`（243件）、`pnpm typecheck`、変更TypeScriptへの `pnpm exec eslint`、IDトレース検査（ERROR 0）。リポジトリ全体の `pnpm lint` は `.agent-shell` を含む作業用ディレクトリ走査が30秒の実行枠を超えるため、変更対象へ限定した。
