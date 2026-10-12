# 動作確認データのリセット

`runtime:reset`は、現在のDBにある全Agentを初期Selfへ戻し、Runtime履歴を消去する破壊的な運用コマンドである。すべてのBot、Scheduler、Debug UIなどDBへ接続するプロセスを停止してから実行する。

```sh
pnpm runtime:reset --confirm
```

`.env`はNodeの`--env-file`で実行時にだけ読み込む。対象は`POSTGRES_URL`の接続先に登録された全Agentであり、環境ファイル自体は変更しない。

## 実行前提

- DBに1体以上のAgentが存在する。
- DB内の各Agentについて、対応する`config/initial-self/*.yaml`がちょうど1件読み込める。
- 全Agentのadvisory lockを取得できる。稼働中Botがlockを保持している場合は、変更せず失敗する。
- 退避対象rootはプロジェクトの`var/`直下以下にある相互に独立したdirectoryで、経路途中を含めsymlinkではない。

## DBで保持・初期化・削除するもの

保持するもの:

- `agents`、`agent_families`、Agent設定
- `agent_lock_keys`
- migration履歴

`agent_states`は初期Self設定から次のように復元する。

- `disposition`: family shared dispositionとinitial dispositionを統合
- `self_story`: self narrativeとself continuityを統合
- `commitments`: 任意のraison d'être
- `mood`、`concerns`、`relationships`: `initialState`
- `version`: `0`

次のRuntime履歴を全件削除する。

- state changes、Tool executions、Agent runs、Events
- Memory本体、subject、Web evidence
- Web snapshots / resources
- Scheduled tasks、autonomous schedules
- Outbox、message receipts
- runtime correlations、rate windows

各Agentについて次の2 scheduleを再作成する。

- `idle`: 実行時刻 + `AUTONOMY_REVIEW_INTERVAL_MS`
- `reflection`: 実行時刻 + `STATE_REVIEW_INTERVAL_MS`

## Runtime fileの退避

`QUEUE_ROOT`と`WEB_ARCHIVE_ROOT`を、削除せず同階層の`<元名>.before-reset-<UUID>`へrenameする。directoryが存在しない場合は何もしない。一般のTool file、log、評価artifact、Discord上の投稿は対象外である。

DB変更はtransaction内で行う。file退避中に通常のerrorが発生した場合はDBをrollbackし、すでに移動したdirectoryを元へ戻す。ただしDBの`COMMIT`とfilesystem renameは単一transactionではないため、process強制終了やcommit時の通信断までを含む完全な原子性は保証しない。

成功時の標準出力には、resetしたAgent IDと退避先directoryをJSONで返す。migrationや別のpersona適用は不要で、そのままBotを起動できる。Botごとに標準設定外のRuntime rootを使っている場合は、このコマンドへ渡されない保存先を別途確認する。
