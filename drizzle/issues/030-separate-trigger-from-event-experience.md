---
created_at: 2026-11-13
status: created
type: change
plan: []
requirements: [C-22, FR-31, FR-60, FR-71, 追加]
requires: human
---

# 030 Trigger metadataとEvent経験要約を分離する

起点：2026-11-13の設計確認。`concern-formation` の定期Scheduleの固定`reason`が、RuntimeでObservationの`summary`と`facts`へ複写され、ReflectionのMemory Formationの根拠になり得る。

## Background

`reason`はEventを起動した運用上の理由であり、今回実際に何が起き、Agentが何を選択し、どの探索結果・状態変化を得たかではない。固定の起動理由を経験要約として再利用すると、同じ抽象文言を根拠にMemoryを形成・再形成する。

一方、Event開始時のObservationはAgent Coreへの入力であるため、Tool実行、Action、状態変化をまだ含められない。完了後の出来事をLLMで要約する処理を開始時Observationへ後付けするのではなく、commit後のExperience Integrationが、確定済みのEvent・Agent Run・Tool結果を根拠に独立したEvent Experienceを生成する必要がある。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | C-22 | 入力Observationと、完了後に形成するEvent Experienceを区別する。前者は起点の客観情報、後者は確定したEvent固有の要約・事実であり、Meaning/Feelingを含めない | spec/personal-agent-implementation-design-v2.md |
| ADDED | FR-75 | Experience Integrationは、commit済みのEvent・Action・Tool結果・状態変化を根拠に、Event固有の`summary`と`facts`をLLMで生成し、生成不能・不要なら明示的に欠損として記録する。固定trigger reason、未確認の推測、主観的Meaning/Feelingは含めない | docs/REQUIREMENTS.md |
| MODIFIED | FR-71 | Memory FormationはEvent Experienceが存在する完了Eventのみを根拠にする。開始時Observationやtrigger metadataだけからMemoryを形成しない | docs/REQUIREMENTS.md |
| MODIFIED | FR-60 | Experience IntegrationのEvent Experience失敗は初回commitを巻き戻さず、Memory Formation対象にもならない | docs/REQUIREMENTS.md |

## 影響範囲

検索した語：`observationFromEvent`、`payload.reason`、`ObservationSchema`、`ExperienceIntegrationOutputSchema`、`events.observation`、`ReflectionInput`、`summaryOf`、FR-60、FR-71、C-22

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/infrastructure/persistence/postgres-agent-context-loader.ts` | `reason`をsummary/factsへ複写している | trigger metadataとして入力に残し、経験要約としては扱わない |
| `src/application/experience-integration.ts` | commit後のLLM出力はMemory/Relationship/Moodだけ | Event Experienceの生成・失敗分離を追加する |
| `src/infrastructure/agent/experience-integration-harness.ts` | 確定済みのEvent/Run/Tool結果を入力済み | Event固有summary/facts用schema・promptを追加する |
| `src/infrastructure/persistence/postgres-experience-integration.ts` | Integration結果とMemory/Stateを保存する | Event Experienceを起点Eventに因果付けて保存する |
| `src/infrastructure/persistence/postgres-reflection.ts` | `events.observation.summary`をMemory Formationへ渡す | Event Experienceだけを取得する |
| `src/infrastructure/persistence/event-transaction.ts` | Event projectionが開始Observationをembeddingする | Event Experienceを検索projectionとする時点・内容を明確化する |
| `src/debug-ui/page.ts` | `content.reason`をEvent概要へfallbackしている | trigger reasonとExperience summaryを別表示にする |
| `spec/personal-agent-implementation-design-v2.md` | ObservationはAgent Core入力と定義 | Event Experienceの永続位置とReflection入力を追記する |
| `docs/REQUIREMENTS.md` / `docs/ARCHITECTURE.md` | FR-60/71とcommit後処理 | 上記差分を反映する |
| `tests/` | 固定reasonとEvent経験の境界を検証していない | integration / persistence / Reflection / UI read modelのtestを追加する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-implementation-design-v2.md` | C-22のObservationとEvent Experienceの二層化 | 承認待ち |
| `docs/REQUIREMENTS.md` | FR-75追加、FR-60/71修正 | 未反映 |
| `docs/ARCHITECTURE.md` | commit後Experience Integrationの成果物とReflection入力 | 未反映 |
| `docs/AGENT_MOTIVATION_MODEL.md` | Trigger → Agent Core → Event Experience → Memory Formationの関係図 | 未反映 |

## Dependencies

- 029（Tool Resultを通常Reflection検索から除外する）

## Scope

- 固定Schedule reasonをEvent固有のsummary/factsとして保存・検索・表示しない。
- Experience Integrationが、確定済みのEvent、Action、Tool結果、State変更だけを根拠に、Event Experience（`summary`、最大4件の具体的`facts`）をLLMで生成する。
- Event Experienceを開始時Observationと別の永続レコードとして保存し、親Event・Integration Runに因果付ける。
- Memory FormationとEvent projection検索はEvent Experienceを利用する。
- Event ExperienceのLLM/schema/保存失敗は初回Action commitを巻き戻さず、そのEventをMemory Formation対象から除外する。

## Out of scope

- Agent Coreの最終出力schemaへsummary/factsを加えること。
- Event開始時のObservationへ、完了後のTool結果やActionを後付けすること。
- Meaning、Feeling、DesireをEvent Experienceへ複製すること。

## Implementation notes

- `Observation`はEvent開始時の入力として不変に保つ。`reason`は`trigger`/scheduler metadataとして保存し、表示できるがsummary/factsにはfallbackしない。
- Event Experienceのschemaは短く固定する。`summary`は1〜2文、`facts`はsummaryと重複しないEvent固有の確認済み事実を最大4件とし、空の経験は明示的に扱えるようにする。
- Experience Integrationは既にcommit後で、source Event、Agent Core assessment/action、Tool実行を入力として持つ。この層に生成責務を置き、Agent Coreの構造化出力を肥大化させない。
- ReflectionのMemory Formationは、成功済みEvent Experienceのみを古い順にbatch化する。固定triggerだけのEvent、Integration失敗Event、経験なしEventを候補に入れない。
- #029と併せ、Tool結果自体は監査用に保持するが、Event Experienceの根拠として要約される範囲に限り、通常検索・Reflectionへ届く。

## Acceptance criteria

- [ ] C-22：開始時Observationと完了後Event Experienceが別の概念・永続記録として扱われる。
- [ ] FR-75：LLMは確定済みのEvent固有summary/factsだけを生成し、固定trigger reasonやMeaning/Feelingを出力しない。
- [ ] FR-71：Memory FormationはEvent ExperienceのあるEventだけを根拠にする。
- [ ] FR-60：Event Experience生成失敗は初回commitを巻き戻さず、そのEventをMemory Formationから除外する。
- [ ] #029：Tool resultの完全本文は通常検索へ入らず、親EventのExperienceに意味づけられた結果だけが検索対象となる。
- [ ] 差分が正の文書に反映される。
- [ ] 上流への反映がすべて反映済みまたは不要になる。

## Tests

- C-22：同じ固定Schedule reasonで複数Eventを起動しても、開始Observationのsummary/factsが固定reasonにならない。
- FR-75：Experience IntegrationがAction、Tool結果、State変更に基づくEvent固有summary/factsを保存し、reason・Meaning・Feelingを混入させない。
- FR-71：Event ExperienceのないEvent、失敗したIntegration、固定triggerだけのEventはMemory Formation batchに含まれない。
- FR-60：Experience Integrationのschema/provider失敗後も親EventのcommitとOutboxが成功状態のまま残る。
- #029：Tool result単体のprojectionは作られず、親Event Experienceだけが検索可能になる。
