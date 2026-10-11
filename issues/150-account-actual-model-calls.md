---
created_at: 2026-10-11
status: done
---

# 150: 実model call数でmaxStepsとbudgetを強制する

優先度: P0

## Background

[敵対再レビュー](../note/adversarial-rereview-2026-10-11.md)の「指摘3」への対応。外側attempt数だけを数えるため、maxSteps=1でも内部Tool pathが2 callを実行しbudgetに1と記録される。

## Scope

- invoker内の実呼出しをrun共通budgetから消費する。
- 最終判断、repair、provider再試行の計数規則を定義しtraceとartifactを揃える。
- 上限到達時は追加callを開始せず明示的な終了結果を返す。

## Out of scope

- Tool回数拡張、token gateの実装。

## Implementation notes

- 失敗した呼出しも送信を試みた回数として記録し、外側attemptとmodelCallsを別概念にする。
- 最終Actionに必要なcallを残せない場合のTool可否を決める。149と同じHarness境界を変更するため実装時は直列化するが論理依存はない。

## Acceptance criteria

- maxSteps=1で内部callが2回走らない。
- Tool、schema repair、timeoutを含む実呼出し数が返却budget・traceと一致する。
- 上限超過の直前で止まり、終了理由が記録される。

## Tests

- call spyによる上限1/2、Toolあり/なし、repair成功/失敗、timeoutの検証。
- 関連unit/system/evaluation test、typecheck、lint。

## Dependencies

- なし。既存実装を起点に着手可能。

## Source plan

- [敵対再レビュー（2026-10-11）: 指摘3](../note/adversarial-rereview-2026-10-11.md)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
