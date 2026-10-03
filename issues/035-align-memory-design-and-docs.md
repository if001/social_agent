---
created_at: 2026-10-04
status: created
---

# 035: Memory設計とdocsの契約をspecへ整合する

## Background

`spec/personal-agent-implementation-design-v2.md`のMemoryはEpisodic、Semantic、Self-relatedの3用途と、Observation、Current State、Active Intention、Social ContextからRelevant Memory Queryを作るRetrievalを定義している。現在のdocsはhybrid検索を記載する一方、保存時Embedding、種類別取得、関連度順維持、query構成の詳細と実装上の未達を明確にしていない。

## Scope

- `spec/`を一次情報としてMemoryとRetrievalの要求を抽出する。
- `docs/REQUIREMENTS.md`、`docs/ARCHITECTURE.md`、`docs/IMPLEMENTATION_PLAN.md`、`docs/TEST_STRATEGY.md`を照合し、不整合を修正する。
- 3種類のMemory、`self-change`の位置づけ、Embedding lifecycle、hybrid score、種類別候補枠、Context budgetまでの契約を確定する。
- Query構成要素、関連度順の保持、Agent分離、出典区別、障害時の扱いを文書化する。
- docs確定後、実装差分をIssue 036、037へ対応付ける。

## Out of scope

- Embedding生成・backfillの実装。
- Retrieval SQLやContext Builderの変更。
- 長期Memory compactionの実装。

## Implementation notes

- 3種類は同一Storeの`kind`で表現する方針を維持する。
- `self-change`は第4の一般Memory用途ではなく、Long-term Review結果を残す派生記録として整理する。
- keyword、vector、recency、importance、kind、subject、intentionをどう合成するか、決定可能な契約にする。

## Acceptance criteria

- [ ] specのMemory／Retrieval要件とdocsの対応表がある。
- [ ] 保存から検索、Context投入までのデータフローがdocsで一意に読める。
- [ ] 3種類と`self-change`の関係が明記される。
- [ ] Issue 036、037の実装境界と完了条件がdocsから導ける。

## Tests

- docs内の型、用語、図、Test Strategyの相互参照を確認する。
- `rg`で旧契約や矛盾するMemory記述が残っていないことを確認する。

## Dependencies

- なし

## Plan reference

- [Implementation Design §16 Memory / §17 Memory Retrieval](../spec/personal-agent-implementation-design-v2.md)
- [Documentation Plan](../docs/DOCUMENTATION_PLAN.md)
- [Implementation Plan: Embedding・Retrieval・Context Builder](../docs/IMPLEMENTATION_PLAN.md)
