---
created_at: 2026-11-22
status: done
type: change
plan: []
requirements: [FR-8]
ui: []
requires: agent
---

# 071 Concernを持続する関心・動機の核として表現する

起点：akaのactive Concern実データのレビュー。Concern本文が、持続する関心よりも会話履歴、根拠、実験手順、予定、約束の運用を抱え込み、関心の重心が見えなくなっていた。

## Background

C-06とFR-8はConcernを、Desireのような今回限りの意図ではなく、複数EventにまたがってAgentが気に掛け、将来の意味づけと行動へ影響する関心・動機として定義している。未解決の問いだけでなく、知りたい、確かめたい、共有したい、守りたい、関係を続けたいことを含む。

一方、現在の詳細設計では次の不整合がある。

- 通常の`concern_propose`は「次に何を明らかにするか」という単発行為寄りの説明である。
- targeted Concern Reflectorの`description` / `whyItMatters`は16,000文字まで許し、Memory・Event・手順・Scheduled Task・Commitmentとの所有境界がdescriptionにない。
- Reflection promptはMemoryから今後も残る関心を積極的に作る一方、Memory本文や会話経緯をConcernへ複製しない制約が弱い。
- 永続`ConcernSchema`は旧データを読むため広い必要があるが、model-facing writerも同じ広い契約を使う箇所がある。

このため、現行LLM出力はschema-validなまま研究ノートや運用計画をConcernへ保存できる。

## Dependencies

- #028 done
- #031 done

## Scope

- Concernを「複数Eventに残る一つの関心対象と、その対象へ向かう現在の動機・気掛かり」と定義する。単発の現在行為はDesire、根拠・発見・会話履歴はMemory / Event Experience、実行日時と手順はScheduled Task、長期に守る原則・役割・約束はCommitment、相手との安定した前提はRelationshipを正本とする。
- Concernは上記の状態から影響を受けてよいが、その本文を履歴保管場所として複製しない。一件のConcernに独立した複数の関心を束ねない。
- `description`は対象と持続する関心・方向を一つの短い現在形で表す。問いの形を必須にせず、「知りたい」「確かめたい」「守りたい」「共有し続けたい」などを許す。次回だけの行為や満足条件の列挙を必須にしない。
- `whyItMatters`は現在のSelf・感情・価値・関係にとって残る理由だけを表し、根拠の時系列、調査結果、手順、日時、配送運用を複製しない。
- model-facing writer用に、`description`最大400文字、`whyItMatters`最大300文字の共通schemaを設け、`concern_propose`、Reflection create/upsert、通常のConcern changeが共有する。既存永続値を読む`ConcernSchema`は16,000文字まで許す互換形として残す。
- Concern Reflectorの`currentDescription`は旧い長文ConcernをRuntimeが既存Recordへ解決するため、入力の完全な現在本文を受けられる互換形のままにする。新しい`description` / `whyItMatters`だけをwriter schemaで制限する。
- Concern lifecycleとReflection promptへ、長文・履歴混入済みConcernが入力された場合、関心の核が続くならupsertで短く正規化し、根拠情報を失わせるためにMemoryを削除・上書きしないことを追加する。
- 自然言語上の境界判定はLLMに任せ、Runtimeで単語一致や禁止語判定を行わない。Runtimeは長さ・構造だけを検証する。

## Out of scope

- Concernを必ず疑問文や解決可能なTaskにすること
- DB table / columnの追加、永続Concern本文の機械的な切り詰め
- 既存DBに残る長大Concernの一括更新（#072で扱う）
- Concernの作成経路、件数、発火Event、終了・時間減衰ロジックの変更

## Implementation notes

- 公開テストseamは、domainのConcern writer schema、targeted Reflection構造出力schema、modelへ渡すJSON Schema description、Concern lifecycle / Reflection system promptとする。
- 永続readerとmodel-facing writerを分離し、旧データを読むだけで通常Eventを失敗させない。
- `CurrentConcernDescriptionSchema`（400文字）と`CurrentConcernImportanceSchema`（300文字）を全model-facing writerで共有した。旧長文は`ConcernSchema`とReflectorの`currentDescription`だけが読み取る。
- Concern lifecycle、通常Reflection、targeted Concern Reflector、Tool descriptionへ、一件一関心とMemory / Desire / Scheduled Task / Commitment / Relationshipの内容所有境界を反映した。
- 既存DBの長大Concernは変更していない。正規化は#072で扱う。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-8 | Concern本文の正本を持続する関心・動機の核とし、Memory、Commitment、Relationship、Scheduled Task、Desireとの内容所有境界を定義する | `docs/REQUIREMENTS.md` |
| ADDED | ADR-23 | 永続readerは旧Concernを許容し、model-facing writerは短い共通schemaへ分離する。意味境界はLLM、長さと構造はRuntimeが検証する | `docs/ARCHITECTURE.md` |

## 影響範囲

検索した語：`ConcernSchema`、`ConcernProposalSchema`、`ConcernReflectorOutputSchema`、`ConcernChangeSchema`、`whyItMatters`、`concernLifecyclePrompt`、`reflectionSystemPrompt`

| 場所 | 内容 | 対応 |
|---|---|---|
| `docs/REQUIREMENTS.md` FR-8 | Concern定義 | 内容所有境界を追記する |
| `docs/ARCHITECTURE.md` | reader / writerと意味判定の責務 | ADR-23を追加する |
| `docs/AGENT_MOTIVATION_MODEL.md` | Concern / Desire / Memory等の関係 | 関心の核と他状態の正本を簡潔に追記する |
| `src/domain/contracts.ts` | 永続Concern、proposal、Reflection change schema | 共通writer schemaを追加し、writerへ適用する |
| `src/application/reflection.ts` | targeted Concern Reflector出力schema | create/upsertの新本文へ共通writer schemaを適用する |
| `src/infrastructure/agent/concern-lifecycle-prompt.ts` | 全経路共通のConcern境界 | 履歴・根拠・手順・予定を複製しない規則を追加する |
| `src/infrastructure/agent/reflection-harness.ts` | Reflection schema description / prompt | 既存長文の正規化とMemoryとの分離を追加する |
| `src/infrastructure/tools/agent-context-tools.ts` | `concern_propose` description | 持続する関心の提案であることを明確にする |
| `tests/unit/domain-contracts.test.ts` | writer / reader契約 | 旧reader許容と新writer制限を検証する |
| `tests/contract/structured-output-description.test.ts` | JSON Schema description | Concernの意味境界がmodelへ渡ることを検証する |
| `tests/unit/agent-prompts.test.ts` | lifecycle / Reflection prompt | 状態間の内容所有境界を検証する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` C-06 | 既にConcernを次Eventにも残る気掛かりとして定義し、description / whyItMattersの責務も持つため変更不要 | 不要 |
| `docs/REQUIREMENTS.md` FR-8 | 内容所有境界を明確化 | 承認済み（本Issueの方針） |
| `docs/ARCHITECTURE.md` ADR-23 | reader / writer・LLM / Runtime責務を追加 | 承認済み（本Issueの方針） |
| `docs/AGENT_MOTIVATION_MODEL.md` | 関係図の説明へ反映 | 承認済み（本Issueの方針） |

## Acceptance criteria

- [x] AC-071-1：Concernは持続する関心・動機を保持し、疑問文や単発Taskを必須にせず、Desire・Memory・Commitment・Relationship・Scheduled Taskとの内容所有境界が要件に明記されている。
- [x] AC-071-2：全model-facing Concern writerが共通の短いschemaとdescriptionを使い、既存永続Concern readerは旧い長文を引き続き読める。
- [x] AC-071-3：Concern lifecycleとReflectionは、根拠・履歴・手順・日時をConcernへ転載せず、既存の冗長Concernを関心の核へ正規化するようmodelへ伝える。
- [x] AC-071-4：Runtimeは自然言語を単語一致で判定せず、schemaの構造・長さだけを検証する。
- [x] AC-071-5：差分が正の文書へ反映され、上流への反映が反映済み又は不要で、`spec-analyze change`にCRITICAL / HIGHがない。

## Tests

- FR-8：永続readerは旧長文Concernを読めるが、proposal / Reflection create-upsertは共通writer上限を超える本文を拒否するdomain test。
- FR-8：Concernの構造化出力descriptionに、持続する関心の核とMemory・計画・予定の非複製境界が含まれるcontract test。
- FR-8：Concern lifecycle / Reflection promptに、疑問文必須ではないこと、複数関心を束ねないこと、既存冗長Concernの正規化が含まれるunit test。

## Verification

- unit / contract: 273 passed
- integration（実PostgreSQL）: 66 passed
- system: 63 passed
- evaluation: 15 passed
- typecheck: passed
- scoped ESLint: passed
- `trace_check`: ERROR 0、#071起因WARN 0（project-wide既知WARN 6）
- fresh-context review: CRITICAL / HIGH / MEDIUM / LOW = 0 / 0 / 0 / 0、merge-ready
- full lintは変更外の既存15 errorsで失敗。#071変更対象にはerror / warningなし
