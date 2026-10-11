---
created_at: 2026-10-11
status: done
---

# 134: 人格上の拒否を外部Actionとして配送する

## Background

[敵対レビューの致命的指摘1](../note/adversarial-review-2026-10-11.md#1-refuse-はユーザーへ配送されない)では、Coreが`refuse`を選んでもRuntimeがOutboxへ登録せず、利用者からは無言に見えると指摘されている。[概念設計 §1・§23](../spec/personal-agent-concept-design-restructured-v2.md)は依頼を断ることを外から知覚できる振る舞いとして要求し、[実装設計 §13・§27](../spec/personal-agent-implementation-design-v2.md)は拒否を外部ActionとOutboxの対象に置く。

## Scope

- `refuse`へユーザーに提示する発話本文を持たせる。
- 通常Event、自律Event、Scheduled Taskのいずれでも、配送先がある`refuse`を`respond`と同じOutbox経路へ登録する。
- personaは内部理由ではなく、ユーザー可視の拒否本文にだけ適用する。
- Action、永続化、Recent Experience、Outbox payloadの契約を揃える。

## Out of scope

- 拒否を発生させる固定ルールや拒否率の導入。
- 質問、共有、提案を新しいAction型へ分割すること。
- 配送先がない内部Eventへ宛先を推測すること。

## Implementation notes

- `reason`は判断根拠、ユーザー可視本文は別フィールドとして区別する。
- `respond`と`refuse`でEnvelope生成を分岐させず、共通の外部発話変換を使う。
- 所有権、idempotency、transaction、Outbox retryの既存保証を維持する。
- 修正時はレビュー本文と上記一次資料を読み直し、拒否を固定Behaviorへ変えない。

## Acceptance criteria

- `refuse`を選んだrunが発話本文を含むOutbox recordをcommitする。
- 通常Eventと配送先を持つ自律Eventの拒否が利用者へ届く。
- 内部理由だけを外部本文として流用しない。
- 配送再試行と重複排除が`respond`と同じ規則で働く。

## Tests

- Action schemaと永続化のcontract test。
- 通常Event、自律Event、Scheduled TaskそれぞれのRuntime system test。
- Outbox配送失敗からの再試行と重複排除test。
- typecheck、lint、関連unit/system suite。

## Dependencies

- なし

## Source plan

- [敵対レビュー: P0-1](../note/adversarial-review-2026-10-11.md#p0-症状を直接止める)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
