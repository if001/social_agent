---
created_at: 2026-10-03
status: doing
---

# 033: 2つのDiscord botを起動して往復と復旧を確認する

## Goal

異なるDiscord資格情報とAgent IDを持つ2 processを共有DB／Queue上で起動し、実利用開始に必要なManual Smokeを完了する。

## Scope

- migrationと2 Agent初期化から起動までの手順を`docs/MANUAL_SMOKE.md`へ確定する。
- 2 botを同一channelまたは構成済みchannelで起動する。
- 各botへの入力、応答、状態・Memory分離、bot間provenanceを確認する。
- 片方停止中の配送、再起動後処理、重複抑止、graceful shutdownを確認する。
- 実行時の接続先、model、build、開始終了、障害を秘密値なしで記録する。

## Stop conditions

- DB、Chat Ollama、Embedding Ollamaへ接続できない場合は作業を止める。
- Discord資格情報またはallowlistが不足する場合は、秘密値の提示を求めず必要な設定名だけを報告する。

## Acceptance criteria

- [ ] 異なるAgent IDの2 processが同時にreadyになる。
- [ ] 各Discord入力へ対応するAgentが応答し、状態とMemoryが混線しない。
- [ ] bot間情報を伝聞として扱い、送信元provenanceを保持する。
- [ ] 片方の停止と再起動でMessageを欠落・重複適用しない。
- [ ] Manual Smoke結果と未解決リスクが記録される。

## Dependencies

- 032
- 034

## Execution log

- 2026-10-03: `.env.ao`と`.env.aka`をprocess環境として検証し、必須設定とBot ID／Discord Queue destinationの分離を確認した。設定値と秘密値は記録していない。
- 2026-10-03: 共有DBへのmigrationと2 Agentの冪等初期化に成功した。
- 2026-10-03: 1体目の起動時、Chat Ollama endpointには到達したが、configured Chat modelが利用可能model一覧に存在しないためStop conditionで停止した。2体目とDiscord Manual Smokeは未実施。
- 2026-10-03: 指定された更新後のChat modelをprocess環境変数として明示して再試行したが、同じく利用可能model一覧に存在せず停止した。
- 起動失敗時cleanupがDB Poolを二重closeして元エラーを隠す問題を修正し、回帰テストを追加した。

## Current blocker

- 各process設定の`OLLAMA_CHAT_MODEL`が、Chat Ollama endpointの利用可能modelと一致する必要がある。
