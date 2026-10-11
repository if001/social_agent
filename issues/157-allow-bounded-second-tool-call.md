---
created_at: 2026-10-11
status: done
---

# 157: 依存取得と失敗回復のために最大25回のTool実行を許可する

優先度: P1

## Background

[敵対再レビュー](../note/adversarial-rereview-2026-10-11.md)の「指摘9」への対応。1 Tool固定では検索→ページ取得や一覧→読取を完遂できず、失敗時に方法を変えられない。

## Scope

- 最大25 Toolと最終Actionからなる有界loopへ拡張する。
- 後続Toolを依存取得または失敗回復に用い、同一Tool・同一入力の反復を拒否する。
- 設定上限、残余model call・token・deadlineを各段で検査する。

## Out of scope

- 無制限loop、既定上限を超える自律探索、汎用middlewareの再導入。

## Implementation notes

- 上限は設定値と25の小さい方とし、0〜24の指定を尊重する。最終Action用callも150のbudgetに含める。
- 後続Toolの許可理由と元Tool結果との関係をtraceへ残す。副作用Toolをrepairで再実行しない。
- 153とHarness変更が重なる場合は直列実装し、段階化を維持する。

## Acceptance criteria

- 検索→取得、一覧→読取、失敗→別手段を設定上限内で継続できる。
- 26回目、同一入力反復、理由のない追加Tool、残余予算不足は停止する。
- 失敗のみでno-external-actionを返す抜け道を作らない。

## Tests

- 依存取得・失敗回復・重複拒否・設定0/1/2/25/26・最終call予算・副作用重複防止テスト。
- 関連system testとpaired live再評価、typecheck、lint。

## Dependencies

- [149](149-gate-every-model-call-input.md)
- [150](150-account-actual-model-calls.md)
- [152](152-reject-no-action-after-failed-tools.md)

## Source plan

- [敵対再レビュー（2026-10-11）: 指摘9](../note/adversarial-rereview-2026-10-11.md)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
