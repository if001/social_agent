---
created_at: 2026-11-26
status: done
type: change
plan: []
requirements: [C-07, FR-3, FR-7, FR-9, FR-41, FR-82, FR-85]
ui: []
requires: agent
---

# 101 Feelingベクトルからの決定論的Mood導出

元計画：2026-11-26のFeeling / Mood再設計に関する合意

## Background

現在のFeelingとMoodは自然言語であり、Feeling / Moodの境界をpromptと
descriptionだけで守っている。結果としてMoodが曖昧な文になり、Experience
Integration又はReflectionがMoodをLLMで任意に更新する。短期Feelingの蓄積・減衰と
個体差を機械的に表現できない。

FeelingはLLMが意味づける短期的な感情、Moodは現在Moodと今回FeelingからRuntimeが
決定論的に更新する感情ベクトルへ変更する。Feeling履歴をMood再計算のために保存しない。
設定変更は将来の更新だけへ適用し、過去Moodを遡及再計算しない。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | C-07 | Feelingを感情カテゴリと強度、Moodを減衰累積ベクトルとして定義する | spec/personal-agent-concept-design-restructured-v2.md |
| MODIFIED | FR-3 | Agent CoreのFeeling出力を構造化affect配列へ変更する | docs/REQUIREMENTS.md |
| MODIFIED | FR-7 | Current StateのMoodを時刻付き感情ベクトルに変更する | docs/REQUIREMENTS.md |
| MODIFIED | FR-9 | MoodをRuntimeが減衰・加算して更新する規則へ変更する | docs/REQUIREMENTS.md |
| MODIFIED | FR-41 | ReflectionはMoodを直接更新しない | docs/REQUIREMENTS.md |
| MODIFIED | FR-82 | Experience IntegrationはMood候補を出力しない | docs/REQUIREMENTS.md |
| MODIFIED | FR-85 | Agent CoreはAssessmentとしてFeelingだけを出力し、Moodを出力しない | docs/REQUIREMENTS.md |

## 影響範囲

検索した語：`Feeling`、`feeling`、`Mood`、`mood`、`PersistentMood`、
`ExperienceIntegrationMood`、`self-mood`。

| 場所 | 内容 | 対応 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md | C-07の概念定義 | 更新する |
| spec/personal-agent-implementation-design-v2.md | 状態、Assessment、Integration、Reflectionの詳細設計 | 更新する |
| docs/REQUIREMENTS.md | FR-3、FR-7、FR-9、FR-41、FR-82、FR-85 | 更新する |
| docs/ARCHITECTURE.md | Runtime / Integration / Reflection境界 | 更新する |
| docs/AGENT_MOTIVATION_MODEL.md | 感情から状態への関係図 | 更新する |
| docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md | Event後の更新フロー | 更新する |
| docs/TEST_STRATEGY.md | 感情ベクトル・減衰・設定の検証 | 更新する |
| config/initial-self/*.yaml | 初期MoodとAgentごとのDynamics | 更新する |
| src/domain/contracts.ts | Affect / Feeling / Mood契約 | 更新する |
| src/application/agent-runtime.ts | commit後のAffect Integrator起動 | 更新する |
| src/application/experience-integration.ts | Mood出力の削除 | 更新する |
| src/application/reflection.ts | Mood出力・更新の削除 | 更新する |
| src/infrastructure/agent/* | Agent Core / Integration / Reflection prompt・schema | 更新する |
| src/infrastructure/persistence/* | `agent_states.mood_vector` JSONB追加とState読書き | 更新する |
| src/debug-ui/* | Moodベクトルの表示 | 更新する |
| tests/ | unit / contract / system / integration / liveの旧文字列Moodを更新する | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md C-07 | Feeling / Moodの構造・責務 | 本会話で承認済み |
| spec/personal-agent-implementation-design-v2.md | 詳細契約と更新順序 | 本会話で承認済み |
| docs/REQUIREMENTS.md | FR-3、FR-7、FR-9、FR-41、FR-82、FR-85 | 本会話で承認済み |
| docs/ARCHITECTURE.md | Runtime境界 | 本会話で承認済み |
| docs/AGENT_MOTIVATION_MODEL.md | 関係図 | 本会話で承認済み |
| docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md | Eventフロー | 本会話で承認済み |
| docs/TEST_STRATEGY.md | テスト対応 | 本会話で承認済み |

## Dependencies

- なし

## Scope

- Feelingを`joy`、`sadness`、`anger`、`surprise`、`anxiety`、`vigilance`、
  `boredom`、`relief`、`pride`、`curiosity`の重複しない1〜3件と、各1〜5の強度で出力する。
- Moodを`updatedAt`とカテゴリ別の連続値からなる時刻付き感情ベクトルとして保存する。
- RuntimeはEvent初回commit後、現在Moodを各カテゴリの半減期で減衰し、今回FeelingをAgent / 感情別のgainで加算してMoodを更新する。
- half-life、gain、上限、初期MoodをAgent設定から読めるようにする。設定変更は以後の更新のみへ適用する。
- Agent CoreはFeelingのみを出力する。Experience IntegrationとReflectionはMoodを出力・更新しない。
- Moodの自然言語表示はRuntime / UIがベクトルから決定論的に作る。LLMへは同じ構造化Moodを渡す。
- 旧文字列Mood、旧Mood writer、旧Mood prompt / skill / schema / migration互換を削除する。

## Out of scope

- Feeling履歴テーブル、設定変更時のMood再計算、過去Feelingの再集計。
- 感情からActionへの固定対応表。
- 感情値を報酬や価値関数として最適化すること。

## Implementation notes

- Moodは同じ係数が固定される限りMarkov状態であり、現在Moodと`updatedAt`だけで次値を正確に算出できる。
- Feelingのカテゴリ選択と強度は自然言語の意味判断なのでLLMが担う。減衰、加算、clamp、表示順はRuntimeが担う。
- 感情ベクトルの連続値はDBに保持し、Agent Core入力・Debug UIでは0〜5へ丸めた上位成分を使う。
- 初回commitに失敗したEventはMoodを更新しない。Affect Integrator失敗は既にcommit済みのAction / Outboxを巻き戻さず、再試行可能な後続更新として監査する。
- `agent_states.mood_vector`追加はDrizzle schemaから生成する。旧自由文Moodは読まず、新ベクトルの初期値から開始する。旧列の物理削除は、追加列が本番適用済みであることを確認した次のDrizzle migrationで行う。

## Acceptance criteria

- [x] C-07：Feelingは構造化カテゴリ・強度、Moodは持続的な減衰累積ベクトルとして定義される。
- [x] FR-3：Agent Coreは意味づけに基づくFeelingだけを構造化出力する。
- [x] FR-7, FR-9：Runtimeは現在Moodと今回Feeling・経過時間からMoodを決定論的に更新する。
- [x] FR-9：Feeling履歴なしで、時刻経過と今回FeelingだけからMoodを更新できる。
- [x] FR-9：Agentごと・感情ごとのhalf-life、gain、上限、初期値を設定できる。
- [x] FR-41, FR-82, FR-85：Reflection、Experience Integration、Agent CoreのいずれもMoodを直接更新しない。
- [ ] 旧自然言語Moodのschema、prompt、skill、writer、互換readerが残らない。
- [ ] 差分が正の文書に反映されている。
- [ ] 上流への反映がすべて反映済み又は不要になっている。
- [ ] `spec-analyze change`でCRITICALとHIGHの指摘がない。

## Tests

- C-07：Feelingが未知カテゴリ・重複カテゴリ・範囲外強度を拒否する。
- FR-3：Agent Core構造出力が1〜3件のFeeling affectだけを返せる。
- FR-7, FR-9：既存Moodを経過時間で減衰し、今回Feelingをカテゴリ別gainで加算する。
- FR-9：FeelingなしのEventでもMoodが時刻に応じて減衰する。
- FR-9：Agent別・感情別Dynamicsが同じFeelingから異なるMoodを作る。
- FR-41, FR-82, FR-85：Integration / Reflectionのモデル出力にMoodがあればschemaで拒否する。
- FR-7, FR-9：本番DBと実LLMでshiroの1 EventがAssessment FeelingとMood更新を完了する。
