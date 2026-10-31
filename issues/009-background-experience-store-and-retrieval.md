---
created_at: 2026-10-29
status: done
type: feature
plan: []
requirements: [C-43, C-44, C-45, C-46, C-47, C-56, FR-53, FR-54, FR-55, NFR-14, NFR-19, AC-14]
requires: agent
---

# 009 Background Experience Storeと共通Retrievalを実装する

元計画：なし（[008](008-prediction-memory-update-docs.md)の設計起点）

## Background

Conversation MemoryとBackground Experienceを別Storeに保持し、両者を単一RetrievalServiceで検索する設計になった。現行の`memories` table、`PostgresMemoryRetriever`、`memory_search`はこの分離に対応していない。

## Dependencies

- 008

## Scope

- `BackgroundExperience`のDomain型とYAML schemaを追加する。
- `config/background-experiences/<agent>.yaml`のloaderとvalidationを追加する。
- `background_experiences` tableとembedding lifecycleを追加する。
- 初期化時にYAMLを検証してBackground Experienceを置換する。プロセス起動中は更新しない。
- 共通`RetrievalService`を追加し、Conversation MemoryとBackground Experienceをvector、keyword、subject、recencyで共通順位付けにする。
- 既存の`PostgresMemoryRetriever`を共通Retrievalへ移行し、`memory_search`と`user_context_get`を共通Retrievalのadapterにする。
- G3/MainAgent向け`retrieval_search` Toolを追加する。
- test fixtureとして少数のBackground Experienceを投入できるようにする。

## Out of scope

- 100件/体の実データ生成（010）。
- G1/G2の予測Loop（011）。
- MemoryWriteService（012）。
- `relationship_search`の変更。RelationshipはStateであり、Memory/Background Experienceの共通Retrievalの対象外とする。
- G3 DeepAgent（014）。

## Implementation notes

- Background ExperienceはConversation Memoryと別tableに置く。
- YAMLはprofileとexperiencesを持ち、現在のユーザーとの共有経験を含めない。
- 検索結果にはConversation MemoryかBackground Experienceかの由来を付ける。
- 既存Toolの独自ranking SQLを残さない。
- embeddingは既存providerを使い、Background Experience用のlifecycleを共通化する。
- 初期化の置換は冪等にし、Conversation Memoryを上書きしない。

## Acceptance criteria

- [x] AC-14：Background Experienceが別Storeで不変であり、現在のユーザーとの共有経験を含まず、共通Retrievalで取得できる。
- [x] `background_experiences`のSchemaとembedding状態をmigrationで作成できる。
- [x] YAMLのSchema、時系列、共有経験不在をvalidationできる。
- [x] `retrieval_search`がconversation、background、allを検索できる。
- [x] `memory_search`と`user_context_get`が共通RetrievalServiceのadapterとして動く。
- [x] 初期化を再実行してもConversation Memoryが変化しない。

## Tests

- FR-53, NFR-19：`tests/unit/background-experience.test.ts`でSchema、時系列、共有経験不在、起動中非更新を検証する。
- FR-55：`tests/unit/retrieval-service.test.ts`でvector、keyword、subject、recencyの共通順位付けを検証する。
- FR-54, NFR-19：`tests/integration/background-experience.test.ts`で別Store、YAML置換、Conversation Memory非上書きを検証する。
- FR-55：`tests/integration/persistence.test.ts`でConversation MemoryとBackground Experienceのunion検索を検証する。
- AC-14：上記のunit/integration testを通す。

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| src/domain/contracts.ts | BackgroundExperience型、Memory kind、Retrieval型 | 追加する |
| src/infrastructure/persistence/schema.ts | background_experiences table | 追加する |
| src/infrastructure/persistence/postgres-memory-retriever.ts | 共通Retrieval | 一般化する |
| src/infrastructure/persistence/postgres-memory-embedding.ts | Background Experienceのembedding | 一般化する |
| src/infrastructure/tools/agent-context-tools.ts | retrieval_searchと既存Tool adapter | 更新する |
| src/bootstrap/bot-composition.ts | RetrievalServiceとToolの配線 | 更新する |
| src/operations/operations.ts | Background Experienceの初期化 | 更新する |
| tests/unit, tests/integration | 追加設計のtest | 追加する |

## 実装メモ

- `background_experiences`を追加し、YAML loader、validation、seeding、embedding lifecycle、`background:embed`を実装した。
- `PostgresRetrievalService`でConversation MemoryとBackground Experienceをvector、keyword、subject、recencyで共通検索する。
- `PostgresMemoryRetriever`は共通Retrievalへ移行し、旧ranking SQLを削除した。
- `memory_search`と`user_context_get`を共通Retrievalのadapterにした。`relationship_search`はStateのため対象外。
- `initializeAgent`はagentId一致を検証し、初期化後にBackground Experienceを置換する。
- レビュー記録：`docs/work/reviews/2026-10-31-issue-009.md`
- 残存MEDIUM：自由記述の実在人物検出は人手レビュー（010）で補完する。embedding lifecycleの完全共通化は将来の整理対象。
