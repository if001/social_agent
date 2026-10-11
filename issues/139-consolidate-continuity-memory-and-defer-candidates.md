---
created_at: 2026-10-11
status: done
---

# 139: ContinuityとMemory抽出を統合しCandidate判定をReviewへ移す

## Background

[敵対レビューの致命的指摘6、重要な指摘、および不要コンポーネント4・8](../note/adversarial-review-2026-10-11.md)では、1 Event後に3系統のLLM処理を行い、単発InteractionごとにCandidate判定まで行う構成が過剰だと指摘されている。[概念設計 §6・§13・§22](../spec/personal-agent-concept-design-restructured-v2.md)では経験の蓄積が重要であり、単発経験を長期変化へ直結させない。

## Scope

- Continuity更新とEpisodic Memory抽出を一つの小さな構造化LLM出力へ統合する。
- 同じEventのSelf、state、recent experience、social contextの重複投入をなくす。
- 毎EventのCandidate Detectorを削除する。
- Long-term Reviewが関連Memoryをまとめて読み、必要なCandidate生成と評価を同じReview周期で行う。

## Out of scope

- Long-term stateの種類や意味を変更すること。
- Memory embedding/rankingの刷新。
- Action配送の非同期化。

## Implementation notes

- EventごとのMemory保存とLong-term変化の判断を明確に分ける。
- Reviewは複数Memory、反復、強い主観的意味を根拠にし、単発から固定的性格を作らない。
- 修正時はレビューと一次資料を参照し、Candidate件数を機械的閾値だけで決めない。

## Acceptance criteria

- 通常Interaction後の状態・Memory用LLM callが最大1回になる。
- InteractionごとのCandidate Detector callがなくなる。
- Long-term ReviewがMemory根拠からCandidate生成と評価を行える。

## Tests

- 統合Post-process schemaと差分適用のcontract test。
- 単発ではCandidateを作らず、反復MemoryをReviewで扱うsystem test。
- retry/idempotency、typecheck、lint。

## Dependencies

- 138

## Source plan

- [敵対レビュー: P1-5](../note/adversarial-review-2026-10-11.md#p1-自律性を状態から駆動する)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
