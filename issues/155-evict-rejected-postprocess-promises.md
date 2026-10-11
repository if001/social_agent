---
created_at: 2026-10-11
status: done
---

# 155: 後処理Promiseの失敗cacheを破棄してretryを回復する

優先度: P1

## Background

[敵対再レビュー](../note/adversarial-rereview-2026-10-11.md)の「指摘7」への対応。combined callがrejectすると失敗Promiseが残り、job retryが同じ失敗を即時再throwする。永続job統合までの局所修正が必要である。

## Scope

- 共有Promiseが失敗またはabortした時のcache cleanupを保証する。
- 同時consumerと遅延cleanupによる新しいentryの誤削除を防ぐ。

## Out of scope

- DB job統合、再起動時のcall重複解消。

## Implementation notes

- post-process-harness.tsでPromise同一性を確認してcleanupする。成功時の共有を維持し、無条件finallyで早期削除して二重callを増やさない。
- 156でcacheを撤去するまでの暫定修正と明記する。

## Acceptance criteria

- 失敗後のretryで新しいmodel callを実行し回復できる。
- 同時consumerは同じ進行中callを共有する。
- 古い失敗のcleanupが新しいentryを消さない。

## Tests

- reject後成功、abort後retry、同時consumer、遅延cleanupの回帰テスト。
- 関連unit test、typecheck、lint。

## Dependencies

- なし。既存実装を起点に着手可能。

## Source plan

- [敵対再レビュー（2026-10-11）: 指摘7](../note/adversarial-rereview-2026-10-11.md)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
