---
created_at: 2026-10-04
status: done
---

# 037: Relevant Memory Queryとrankingを設計どおり実装する

## Background

現在は`Observation.summary`だけをquery化し、検索後にContext BuilderがMemoryを新しい順へ並べ替える。Current State、Active Intention、Social Context、kind、importance、subject関連が検索に反映されず、関連度順もtoken budgetまで維持されない。日本語に対するPostgreSQL `simple`全文検索だけではkeyword recallも弱い。

## Scope

- Issue 035のdocs契約を確認し、実装前にranking式とfallbackをdocsへ反映する。
- Observation、Dynamic State、Active Intention、Social Contextから決定的なRelevant Memory Queryを構築する。
- keyword／vector／subject／intentionから候補poolを作り、順位統合後にrecency／retrieval priority／kindを反映する候補選択を実装する。
- Episodic、Semantic、Self-relatedが必要に応じてContextへ入る種類別候補枠を実装する。
- Retrieverの関連度順をContext budget適用後まで保持する。
- 日本語keyword検索の方式またはvector中心のfallbackを確定する。

## Out of scope

- 保存時Embedding生成とbackfill。
- LLMを使ったMemory Query生成。
- 長期Memory compaction。

## Implementation notes

- query入力に秘密値や他Agentの状態を含めない。
- scoreの尺度が異なる要素を単純加算せず、正規化またはReciprocal Rank Fusion等の順位統合を定義する。
- Embedding障害時にもAgent単位のkeyword／recency fallbackで処理可能にする。

## Acceptance criteria

- [x] specの4入力要素がquery／filter／rankingへ反映される。
- [x] 3種類のMemoryを意図した候補枠で取得できる。
- [x] token不足時にも関連度の高いMemoryが優先される。
- [x] 自然言語`significance`とは別の限定値`retrievalPriority`と、subject／intention関連がrankingへ反映される。
- [x] 各候補の候補化理由、最終順位、採用・除外理由をtraceできる。
- [x] Agent分離と安定したtie-breakを維持する。

## Tests

- 同じObservationでState／Intention／Social Contextだけを変えたranking test。
- 3種類、importance、subject、intention、recencyの順位test。
- 日本語query、Embeddingなしfallback、安定tie-breakのintegration test。
- Context budgetで低関連Memoryだけが除外されるtest。

## Dependencies

- 035
- 036

## Plan reference

- [Implementation Design §17–18](../spec/personal-agent-implementation-design-v2.md)
- [Architecture: Context Builder and Retrieval](../docs/ARCHITECTURE.md)
