---
created_at: 2026-11-20
status: done
type: change
plan: []
requirements: [FR-6, FR-41, FR-42, FR-82]
ui: []
requires: agent
---

# 054 Self / Relationship のwriter契約を正規化する

元計画：[Self / Relationship出力契約レビュー](../docs/work/analyze/2026-11-20-self-relationship-contract-review.md)

## Background

Self/Mood Reflectorの`self`は共通`SelfSchema`を出力に使うが、`identity`、`disposition`、`commitments`のモデル向けdescriptionがない。`commitments`の件数・本文もproductionのtarget schemaでは制限されず、Self Storyと同じく履歴・Task・Desireが膨張混入する余地がある。

Relationship本文の共通descriptionは適切だが、Experience Integrationの`relationship.operation`と`reason`は説明を持たず、Reflection skillも現在状態として残す内容を十分に絞れていない。

## Dependencies

- 051（Self Story / Relationshipの現在状態化）
- 053（持続状態のdescription契約）

## Scope

- `identity`、`disposition`、`selfStory`、`commitments`の役割を共有schema descriptionで明確化する。
- Self/Mood Reflectorが出力するSelfへ、完全値・Memory根拠・長期変化だけという制約を保ったまま、commitmentsの件数・本文のwriter上限を導入する。
- `reflection-self-mood` skillを、更新条件、Self各fieldの最小限の分離、保存対象外、担当範囲だけに絞る。
- Experience IntegrationのRelationship候補の全fieldへdescriptionを付ける。
- `reflection-relationship` skillを、更新条件、関係として残す現在状態、保存対象外、担当範囲だけに絞る。
- 既存DBのSelf / commitmentsが新writer上限を超えるか読み取り専用で確認する。reader互換性を維持したままwriterだけを切り替えられない場合は、data migrationの方針を提示してユーザー確認を求める。
- schema descriptionとskill / prompt契約をunit testで確認する。

## Out of scope

- Self、Relationshipのtable分離
- 自然言語を単語一致で機械的に意味検査すること
- Selfの通常Event更新
- Relationship subject解決方式の変更

## Implementation notes

- Selfの意味境界はLLMが判断し、Runtimeはfield完全性、所有権、件数・文字数、Memory根拠、競合を検証する。
- `selfStory`は現在の自己理解・継続する役割・現在の変化、`commitments`は守るもの・続ける関係・譲らないことだけを持つ。出来事の履歴はMemory、実行時刻と仕事はScheduled Task、継続的な関心はConcern、今回のやりたいことはDesireへ分ける。
- Relationshipは現在の関係の型・安定した会話前提・未解決の約束だけを持ち、個別Event、人物プロフィール、Concern、Feeling、応答方針を持たない。
- target system promptはskill routingを維持して最小にし、detailはschema descriptionとtarget skillへ置く。

## Acceptance criteria

- [x] AC-054-1：Self/Mood Reflectorのモデル向けJSON Schemaで、Selfの全fieldとcommitments itemsに説明がある。
- [x] AC-054-2：新規・更新Selfのcommitmentsに、共通の件数・本文上限があり、Self Story、Memory、Concern、Desire、Scheduled Taskとの境界を説明する。
- [x] AC-054-3：Experience IntegrationとReflectionのRelationship出力の全fieldに説明があり、現在の関係状態だけを保存対象とする。
- [x] AC-054-4：Self / Relationship skillは詳細仕様を重複せず、更新条件・禁止対象・担当範囲だけを記載する。
- [x] AC-054-5：既存Selfを安全に読め、必要なdata migrationなしにreaderを壊さない。migrationが必要なら実行前にユーザー確認を求める。
- [x] AC-054-6：schema、prompt、skill、境界・上限を検証するtestがある。

## Tests

- FR-6：Self StoryとCommitmentsのfield description、writer制限、既存Selfのreader互換性をUnit testで確認する。
- FR-41, FR-42：Self/Mood Reflectorのschemaとskillが完全なSelf・Memory根拠・対象外を表すことをUnit testで確認する。
- FR-82：Experience IntegrationのRelationship schema / promptがactorに束縛された持続的関係だけを扱うことをUnit testで確認する。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-6 | Commitmentsの保存対象・共通writer境界を明確化する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-42 | Reflector出力schemaのSelf / Relationship description契約を明確化する | `docs/REQUIREMENTS.md` |
| MODIFIED | FR-82 | Experience IntegrationのRelationship候補field契約を明確化する | `docs/REQUIREMENTS.md` |

## 影響範囲

検索した語：`SelfSchema`、`CurrentSelfStorySchema`、`CurrentRelationshipDescriptionSchema`、`reflection-self-mood`、`reflection-relationship`、`ExperienceIntegrationOutputSchema`。

| 場所 | 内容 | 対応 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` C-05 / C-09 | Self・Relationshipの概念境界 | 更新しない。既存概念と整合する |
| `docs/REQUIREMENTS.md` FR-6 / FR-42 / FR-82 | writer契約 | 更新する |
| `src/domain/contracts.ts` | Self・Relationshipの共有schema | 更新する |
| `src/application/reflection.ts` | Self/Mood・Relationship Reflector出力 | 更新する |
| `src/application/experience-integration.ts` | Relationship候補出力 | 更新する |
| `src/infrastructure/agent/*-harness.ts` | target promptとExperience Integration prompt | 更新する（共通description参照だけ） |
| `skills/reflection-self-mood/SKILL.md` | Selfの更新条件と対象外 | 更新する |
| `skills/reflection-relationship/SKILL.md` | Relationshipの更新条件と対象外 | 更新する |
| `src/infrastructure/persistence/*` | 既存Selfのreader互換性 | 読み取り確認。migrationが必要な場合だけ別途提案 |
| `tests/unit/*` | schema / prompt / skill契約 | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` | C-05 / C-09の既存定義に従う | 不要 |
| `docs/REQUIREMENTS.md` | FR-6 / FR-42 / FR-82のwriter契約 | 反映済み |

## 実装メモ

- `SelfSchema` をmodel / writer専用のbounded contractとし、既存DBを読む
  `PersistedSelfSchema` を分離した。既存の過長なCommitmentsは読み取りで
  停止させず、Selfが更新される場合だけwriter境界を適用する。
- `initializeAgent` と `resetRuntime` は `initialSelfFromConfig` を通して
  同じwriter契約を適用する。
- 既存DBの読み取り専用確認では、稼働中の3 Agentはいずれも新しい上限内で
  あり、migrationは不要だった。
- 追加・更新した検証: `tests/unit/domain-contracts.test.ts`、
  `tests/unit/reflection-harness.test.ts`、
  `tests/unit/experience-integration.test.ts`。
- レビュー: `docs/work/reviews/2026-11-20-issue-054.md`。
