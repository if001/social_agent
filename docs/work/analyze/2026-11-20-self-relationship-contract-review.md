# 分析レポート：Self / Relationship の出力契約（2026-11-20）

## 対象

| 項目 | 内容 |
|---|---|
| 基準 | `spec/personal-agent-concept-design-restructured-v2.md` C-03, C-05, C-09, C-12、`docs/REQUIREMENTS.md` FR-6, FR-41, FR-42, FR-82 |
| 照合した成果物 | Domain schema、Experience Integration / Reflection schema・system prompt、`reflection-self-mood` / `reflection-relationship` skill |
| 対象コミット | `790c9ef` |

## 要約

| 重大度 | 件数 |
|---|---|
| HIGH | 1 |
| MEDIUM | 2 |
| LOW | 0 |

## 指摘

| # | 重大度 | 内容 | 根拠 | 推奨する対応 |
|---|---|---|---|---|
| 1 | HIGH | `SelfMoodReflectorOutputSchema.self` は共通 `SelfSchema` をそのまま出力schemaに使うが、`identity`、`disposition`、`commitments` の field description がない。`reflection-self-mood` skill も「完全なSelf」としか指示せず、selfStory と commitments の役割分離、出来事・現在のTask・Desireを入れない境界をモデルに示さない。 | `src/domain/contracts.ts`、`src/application/reflection.ts`、`skills/reflection-self-mood/SKILL.md` | Self field の共有descriptionを定義し、Self/Mood Reflector のschemaとskillで、selfStory=現在の自己理解、commitments=守るもの・続ける関係・譲らないこと、履歴/Task/Desire/Concernを入れないことを明示する。 |
| 2 | MEDIUM | `SelfSchema.commitments` は各要素16,000文字・配列無制限で、productionのSelf/Mood Reflector出力にも同じ上限が適用される。旧generic Reflection schemaだけが12件上限を持つため、経路によって契約が異なる。 | `src/domain/contracts.ts`、`src/infrastructure/agent/reflection-harness.ts` | Current Selfの共通契約として件数・各要素の文字数を決め、全writerと初期設定で共通schemaを使う。値は内容に応じてMemory / Scheduled Task / Concernへ分ける。 |
| 3 | MEDIUM | Relationship本文の共通description（400文字、現在の関係の型・安定した前提・未解決の約束、個別EventはMemory）は要件に沿う。一方、Experience Integrationの`relationship.operation`と`reason`にfield descriptionがなく、prompt / skillも「何を現在状態として書くか」を強く反復していない。 | `src/domain/contracts.ts`、`src/application/experience-integration.ts`、`src/infrastructure/agent/experience-integration-harness.ts`、`skills/reflection-relationship/SKILL.md` | operation・reasonを説明付きschemaにし、両writerに「関係の型・安定した会話前提・未解決の約束だけ。出来事の履歴、人物プロフィール、Concern、Feeling、応答方針は入れない」を明記する。 |

## 整合している点

- `CurrentSelfStorySchema` は600文字で、現在の自己理解・継続する役割・現在の変化だけを表し、時系列・調査結果・完了TaskをMemoryへ分けるため、FR-6と合う。
- `CurrentRelationshipDescriptionSchema` は400文字で、現在の関係の型・安定した前提・未解決の約束だけを表し、個別Eventと日付列挙をMemoryへ分けるため、C-09と合う。
- Experience IntegrationはSelfを更新せず、Selfの変更をReflectionに限定している。Relationshipの対象subjectはRuntimeがactorから解決するため、モデルにIDを出させない設計もFR-77 / FR-82と合う。

## system prompt / skill の判断

Reflectionのtarget system promptが短くskillを読むよう促す方式自体は、FR-47の最小system prompt方針に合う。したがってSelf / Relationshipの詳細契約はsystem promptへ常駐させず、共有schema descriptionと対象skillに置くのが適切である。repairには同じ説明付きschemaが渡るため、schemaを正すことでrepair経路も同時に改善される。
