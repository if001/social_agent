---
created_at: 2026-10-11
status: done
---

# 138: Action配送をPost-processの完了・失敗から分離する

## Background

[敵対レビューの致命的指摘6とP0-5](../note/adversarial-review-2026-10-11.md)では、Runtimeがcontinuity、memory extraction、candidate detectionを同期的に待ち、状態整理の遅延や失敗が応答経路へ波及すると指摘されている。[実装設計 §3](../spec/personal-agent-implementation-design-v2.md)は、Core出力の検証・commit後に配送と後処理を進め、後処理完了を配送の前提にしないと定める。

## Scope

- Core結果、Run、Tool履歴、Outboxを同じtransaction境界で先にcommitする。
- Post-processをcommit後の独立jobとして起動し、Action returnとOutbox配送を待たせない。
- Post-processの失敗、timeout、再試行状態をAction配送と別に記録する。
- process再起動後も未完了jobを再開できる最小限の永続実行契約を設ける。

## Out of scope

- continuityとmemory extractionの統合。
- Candidate検出をReviewへ移すこと。
- 外部配送先のexactly-once保証。

## Implementation notes

- fire-and-forget Promiseだけにせず、処理漏れを検出・再開できるrecordを持つ。
- 同じEventのPost-processを再実行しても重複Memoryや状態二重更新を作らない。
- 応答commit失敗時はPost-processを開始しない。
- 修正時はレビューと実装設計を参照し、配送済みと後処理済みを同じstatusへ畳み込まない。

## Acceptance criteria

- Post-processが遅延または失敗しても、commit済みActionを返しOutboxから配送できる。
- 未完了jobを再起動後に検出して再試行できる。
- 同一jobの再実行がidempotentである。
- observabilityでAction配送とPost-process結果を別々に追跡できる。

## Tests

- Post-processの遅延、例外、timeoutを注入するRuntime system test。
- process再開と重複実行のintegration test。
- Outbox配送失敗との組み合わせtest。
- typecheck、lint。

## Dependencies

- 134

## Source plan

- [敵対レビュー: P0-5](../note/adversarial-review-2026-10-11.md#p0-症状を直接止める)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
