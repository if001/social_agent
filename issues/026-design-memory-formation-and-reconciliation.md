---
created_at: 2026-11-13
status: done
type: change
plan: []
requirements: [C-03, C-10, C-15, C-55, FR-41, FR-42, FR-55, FR-57, FR-58, FR-60, FR-71, FR-72, FR-73, FR-74]
requires: agent
---

# 026 Event起点のMemory Formationと再活性化ベースMemory Reconciliationを設計する

元計画：2026-11-13のReflection input token超過調査と、ユーザー承認済みのA/B方針。

## Background

現行Memory Reflectorは最大32 Eventのbatchごとに最新32 Memoryを全文入力して比較する。そのため既存Memory本文が増えるとモデル入力が8,000推定tokenを超え、Reflection全体が停止する。また、古い未処理Eventが新しいMemory候補を内容一致だけで更新でき、経験の時系列を巻き戻し得る。

Agentの経験を長期的に統合するというC-03 / C-10に沿い、Memory処理を二つに分離する。

- A. **Memory Formation**：未統合Eventを古い順に16件ずつ扱い、将来再利用すべき新しい経験を形成する。
- B. **Memory Reconciliation**：再活性化された既存Memoryを起点に、関連Memory・関連Eventをagent的に取得し、Memory種別に応じて補強・訂正・分割・維持を判断する。

## Dependencies

- 024（固定Event窓・Memory batch・直接根拠）
- 025（Memory Reflector縮小schema・repair）

## Scope

- A/Bの責務、入力境界、更新権限、監査単位、retry境界を`docs/REQUIREMENTS.md`、`docs/ARCHITECTURE.md`、`docs/AGENT_MOTIVATION_MODEL.md`へ定義する。
- Aは最大16 Eventの未統合Event群からMemoryを**新規形成**し、古いEventで新しいMemoryを上書きしない方針を定義する。
- Bは全Memory走査ではなく、再活性化selectorが選んだ少数のアンカーMemoryまたは関連クラスターを扱う方針を定義する。
- `episodic`、`semantic` / `common-ground`、`self-related` / `self-change`の更新・分割・維持・矛盾の扱いを定義する。
- EventをRAGで取得するために現行保存済み情報で足りるか、Event projection / embedding / hybrid ranking / actor・時刻filterが必要かを監査する。方針を決められない場合は実装Issueを止め、選択肢をユーザーへ提示する。
- Memoryの再活性化候補（新規形成による影響、利用・Concern根拠、未再検討、遠い連想）の選定根拠と、全件走査を避ける予算を定義する。

## Out of scope

- Memory内容を人間の記憶モデルに完全に一致させること。
- Background Experienceの更新。
- Event sourceや通常Agent CoreのAction生成を変更すること。
- A/B実装、migration、既存Reflection runの再処理。

## Implementation notes

- Bの関連Event取得はMemoryより前後を入口で分離しない。時系列は取得後の統合・訂正判断に使う。
- 現行`RetrievalService`はConversation Memory / Background Experienceだけを対象とし、EventはRAG corpusではない。この差分と流用可能なhybrid ranking、subject、recencyの契約を明記する。
- 必要な新規用語とIDは文書Issueで追加する。一次specの目的・語彙を変える必要が判明した場合は、実装前にユーザー承認を得る。

## Acceptance criteria

- [x] C-03, C-10：A/Bが経験の形成と既存経験の再統合を分離し、どちらがSelf / Relationship / Concernへ渡す根拠を作るかを定義した。
- [x] C-15, FR-41, FR-60：古いEventが新しいMemoryを内容一致だけで上書きしない更新権限・時系列規則を定義した。
- [x] FR-55, FR-74：BのMemory検索とEvent検索のRAG境界、流用可能な現行Retrievalと追加が必要な保存・検索経路を定義した。
- [x] FR-42, FR-57, FR-58：A/Bのstructured output、MemoryWriteService、監査、retry境界を定義した。
- [x] FR-72：再活性化対象の選定が全件走査や最新偏重だけに依存せず、有限の予算で説明可能である。

## Tests

- 文書検査：追加・変更する要件ID、用語、図、実装Issueの依存関係をtrace_checkで検証する。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-41, FR-42, FR-55, FR-57, FR-58, FR-60 | Reflection内のMemory処理をFormation / Reconciliationへ分離し、入力・更新・retry・RAG境界を明確化する | `docs/REQUIREMENTS.md` |
| ADDED | FR-71, FR-72, FR-73, FR-74 | Memory Formation、Memory Reconciliation、再活性化selector、Event projectionの用語・要件 | `docs/REQUIREMENTS.md`、`docs/ARCHITECTURE.md`、`docs/AGENT_MOTIVATION_MODEL.md`、`docs/TEST_STRATEGY.md` |

## 影響範囲

検索した語：`Reflection`、`Memory Reflector`、`MemoryIntent`、`MemoryWriteService`、`RetrievalService`、`retrieval_search`、`events`、`embedding`、`evidenceEventIds`。

| 場所 | 内容 | 対応 |
|---|---|---|
| `spec/personal-agent-concept-design-restructured-v2.md` | C-03 / C-10 / C-15との整合 | 確認する。概念変更が必要な場合のみ承認を得る |
| `docs/REQUIREMENTS.md` | A/Bの要件と更新権限 | 更新する |
| `docs/ARCHITECTURE.md` | Event→Formation→Reactivation→Reconciliationの関係 | 更新する |
| `docs/AGENT_MOTIVATION_MODEL.md` | ReflectionとMemoryの関係図 | 更新する |
| `docs/TEST_STRATEGY.md` | Formation / Reconciliation / Event projectionの検証境界 | 更新する |
| `src/application/reflection.ts` | 現行batch / target契約 | 後続Issueで更新する |
| `src/application/memory-write-service.ts` | create / update判定・時系列保護 | 後続Issueで更新する |
| `src/infrastructure/persistence/postgres-retrieval-service.ts` | Memory RAGの流用範囲 | 後続Issueで更新要否を確定する |
| `events` / `memories` schema | Event RAGと再活性化状態 | 後続Issueでmigration要否を確定する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `docs/REQUIREMENTS.md` | A/Bの責務・更新権限・RAG境界 | 反映済み |
| `docs/ARCHITECTURE.md` | A/B処理とMemory種別ごとの更新経路 | 反映済み |
| `docs/AGENT_MOTIVATION_MODEL.md` | MemoryとReflectionの関係図 | 反映済み |
| `docs/TEST_STRATEGY.md` | A/BとEvent projectionの検証境界 | 反映済み |
| `spec/personal-agent-concept-design-restructured-v2.md` | 概念変更が必要な場合のみ | 不要（C-03 / C-10 / C-15の実装具体化） |

## 実装メモ

- 監査の結果、`events`には時刻・種別・観測JSONはあるが、embedding・subject索引・検索本文がない。関連Eventのhybrid RAGには、元Eventを正本として残す検索専用Event projectionが必要と確定した。
- Memory Formationは16 Event以下の固定batchから新規Memoryだけを形成する。Memory Reconciliationだけが既存Memoryを種別規則に従い再統合する。
- Reconciliationは理由ごと最大1件、Session合計最大4件のアンカーをround-robinし、各アンカーの取得を関連Memory最大6件・関連Event最大16件に限定する。
- 検証：`pnpm typecheck`、`pnpm lint`、`pnpm test`（212 passed）、`trace_check.py`。trace_checkのERROR 5 / WARN 6は既存の重複IDと後続実装前の要件test未参照であり、新規ERRORはない。
- 独立レビュー：[`2026-11-13-issue-026.md`](../docs/work/reviews/2026-11-13-issue-026.md)。Critical 0 / High 0、検出したMedium 5件を修正済み。
