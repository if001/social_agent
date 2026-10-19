---
created_at: 2026-10-11
status: done
---

# 147: Live評価でTool選択・配送・次stateを実行して記録する

優先度: P0

## Background

[敵対再レビュー](../note/adversarial-rereview-2026-10-11.md)の「指摘1・8」への対応。現行executorはHarness出力を返すだけで配送や次stateを確認しない。run-live.tsもToolを登録しておらず、自律選択の観測経路が不足している。

## Scope

- 本番RuntimeのAction適用、Outbox配送、状態更新経路を評価用の隔離環境へ接続する。
- 実モデルが選択できるTool registryを接続し、Tool traceと実行結果を記録する。
- Action、chosen Motive、配送record、適用済みnextStateを収集し、複数turnへ引き継ぐ。
- schema、timeout、Tool、delivery、配線、semanticの失敗を区別し、失敗試行もartifactへ残す。

## Out of scope

- 反復分布の合否判定、外部ユーザーへの実送信、固定Actionを返すfakeを自律性の証拠にすること。

## Implementation notes

- 146の契約を利用する。配送先は評価専用sinkとし、本番配送処理を経由したrecordで成功判定する。
- 質問・共有等の判別可能なラベルはActionとtraceから導出し、感情表明・脱線等だけsemantic evaluatorを使う。
- 後処理完了の待機境界を設け、proposalと適用済みstateを混同しない。semantic evaluator失敗も元の試行結果を消さない。

## Acceptance criteria

- Live entrypointから実モデルによるTool選択、配送、state適用が到達可能である。
- delivery非対象と成功・失敗を区別し、出力の手入力で成功扱いにしない。
- 試行間・Agent間は隔離され、同一試行内の次turnのみstateを引き継ぐ。
- 失敗種類と失敗段階、観測根拠をartifactから追える。

## Tests

- 評価Runtimeの配送成功・失敗、state引継ぎ、Tool失敗、timeoutの決定的結合テスト。
- pnpm test:evaluation、関連system/integration test、typecheck、lint。実モデル反復の証拠は148で取得。

## Dependencies

- [146](146-define-state-dependent-paired-scenarios.md)

## Source plan

- [敵対再レビュー（2026-10-11）: 指摘1・8](../note/adversarial-rereview-2026-10-11.md)
- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md)
