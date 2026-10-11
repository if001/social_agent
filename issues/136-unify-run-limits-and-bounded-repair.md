---
created_at: 2026-10-11
status: done
---

# 136: Run limitを一本化し修復入力を有界化する

## Background

[敵対レビューの致命的指摘3・4](../note/adversarial-review-2026-10-11.md)では、公称`maxSteps`とGraphへ渡す最低64 step、別管理のmodel call上限が競合し、validation repairが失敗時ほど入力を膨らませると指摘されている。[実装設計 §27・§29](../spec/personal-agent-implementation-design-v2.md)が要求するdeadlineと実行上限を、観測値と実効値が一致する一つの契約へ戻す。

## Scope

- `Math.max(64, recursionLimit)`を廃止し、設定したrun limitを実行層へそのまま適用する。
- step、model call、Tool call、finalize/repairの関係を一つのRun Budgetとして定義する。
- log、error、保存されたrun summaryへ実際の上限と消費量を記録する。
- validation repairは元の巨大入力を再送せず、無効な出力、validation issue、最小schema指示だけで行う。
- deadline/abortを通常call、Tool call、repairの全段階で共通に強制する。

## Out of scope

- Deep Agentsを明示的な2段loopへ置き換えること。
- Contextに含める状態の選択規則。
- Toolごとの業務的な実行上限変更。

## Implementation notes

- `maxSteps`という名前を残す場合も、何を1 stepと数えるかを型と文書で一意にする。
- limit超過はfinal Actionの欠落と区別できるerror codeを持たせる。
- repairが利用できるevidence IDを失わない一方、元Context全体は再投入しない。
- 修正時はレビュー本文と一次資料を参照し、ログ上だけ整合した見かけのlimitにしない。

## Acceptance criteria

- 設定、Schema、log、実行Graphで同じlimit値が使われる。
- 標準設定のrunが隠れた64 step上限を持たない。
- repair入力は6,000 token gateの対象となり、元入力より無制限に増えない。
- limit到達とvalidation失敗を利用者・運用者が区別できる。

## Tests

- 各予算の境界値unit/contract test。
- Toolあり/なし、repairあり/なしの消費量system test。
- deadlineとabortのsystem test。
- typecheck、lint、関連evaluation。

## Dependencies

- 135

## Source plan

- [敵対レビュー: P0-2・P0-3](../note/adversarial-review-2026-10-11.md#p0-症状を直接止める)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
