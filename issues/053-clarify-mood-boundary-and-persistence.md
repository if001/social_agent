---
created_at: 2026-11-20
status: completed
type: change
plan: []
requirements: [FR-9, FR-41, FR-82, FR-87]
ui: []
requires: agent
---

# 053 Moodの境界と永続化契約を明確化する

元計画：shiroの実State監査

## Background

shiroの`agent_states.mood`に、探索テーマ、Concernの進展、ユーザーへの届け、返答待ち、次のActionが混在していた。Moodは複数Eventの意味づけと行動の調子を変える持続的な感情状態であり、Memory、Concern、Relationship、Desireの代替保存先ではない。

## Dependencies

- 051（Current Self / Relationshipの現在状態化）

## Scope

- Moodを「持続する感情的構え」と定義し、Experience IntegrationとSelf / Mood Reflectorで同一のdescription契約を使う。
- Mood本文を短い一文へ制限し、出来事、探索テーマ、固有名詞、ユーザー、返答待ち、約束、Concern、行動計画、願望、理由を禁止する。
- Experience Integrationのsystem prompt、Reflectionのtarget skill / system promptを同じ境界へ更新する。
- schema検証とprompt / skill contractをunit testで確認する。

## Out of scope

- Moodを別tableへ分離すること
- Moodを決定論的に自動抽出すること
- 既存Moodの実LLM再要約

## Implementation notes

- Moodを更新するかどうかはLLMが自然言語で判断する。文字数・出力形・更新の競合検証はRuntimeが担う。
- 現在のMoodを直ちに消去しない。以後のExperience IntegrationまたはReflectionで契約に沿う値へ更新する。

## Acceptance criteria

- [x] AC-053-1：Experience IntegrationとSelf / Mood ReflectorのMood schema descriptionが、持続的な感情的構え・含めない情報・省略条件を同じ内容で示す。
- [x] AC-053-2：両prompt / skillがMoodをMemory、Concern、Relationship、Desireと明確に分離する。
- [x] AC-053-3：Moodは短い一文の上限を持ち、長い出来事列挙を永続化できない。
- [x] AC-053-4：schemaおよびprompt / skillを検証するテストがある。

## Tests

- FR-9, FR-87：Mood schemaが一文の持続的感情状態を要求し、長文を拒否する。
- FR-41, FR-82：Reflection / Experience IntegrationのpromptとskillがMoodの境界を明記する。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-9 | Moodの保存対象・境界・上限を明確化する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-41 | Self / Mood ReflectorのMood統合契約を明確化する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-82 | Experience IntegrationのMood候補契約を明確化する | `docs/REQUIREMENTS.md` |

## 影響範囲

検索した語：`MoodSchema`、`SelfMoodReflectorOutputSchema`、`mood:`、`reflection-self-mood`。

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/application/experience-integration.ts` | Experience IntegrationのMood出力schema | 更新する |
| `src/application/reflection.ts` | Self / Mood ReflectorのMood出力schema | 更新する |
| `src/infrastructure/agent/experience-integration-harness.ts` | Experience Integration prompt | 更新する |
| `src/infrastructure/agent/reflection-harness.ts` | Reflection system / target prompt | 更新する |
| `skills/reflection-self-mood/` | target skill | 更新する |
| `src/domain/contracts.ts` | State Moodの永続化上限 | 更新する |
| `tests/` | schema / prompt / skill契約 | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` | C-07の既存定義に従う | 不要 |
| `docs/REQUIREMENTS.md` | FR-9 / FR-41 / FR-82のMood境界 | 完了 |
