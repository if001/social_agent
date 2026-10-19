---
created_at: 2026-10-11
status: done
---

# 152: 失敗Toolだけではno-external-actionを許可しない

優先度: P0

## Background

[敵対再レビュー](../note/adversarial-rereview-2026-10-11.md)の「指摘10」への対応。ToolExecutionRecordの件数だけの検証は、検索失敗後も何もできず無言終了するActionを許してしまう。

## Scope

- no-external-actionを正当化する実行証拠を成功したToolに限定する。
- 失敗のみなら説明・質問または予算内の別手段を要求する。
- 既存repair/終了経路で検証違反を観測可能にする。

## Out of scope

- 追加Tool loopの実装、成功結果の有用性を一律semantic判定すること。

## Implementation notes

- actionExecutionIssues()でokを検査する。成功と失敗が混在した場合の扱いも定義する。
- call予算が尽きた場合は追加callを強制せず、検証失敗として終了理由を残す。

## Acceptance criteria

- 失敗recordだけのno-external-actionは拒否される。
- 成功Toolを伴う既存の正当な無発言Actionは維持される。
- 失敗時に説明等へ修復する経路と予算切れの経路を区別できる。

## Tests

- Toolなし、全失敗、成功あり、混在、repair予算切れのテスト。
- 関連unit/system test、typecheck、lint。

## Dependencies

- なし。既存実装を起点に着手可能。

## Source plan

- [敵対再レビュー（2026-10-11）: 指摘10](../note/adversarial-rereview-2026-10-11.md)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
