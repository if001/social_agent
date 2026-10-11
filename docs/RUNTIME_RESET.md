# 動作確認データのリセット

すべてのBotを停止してから実行する。

```sh
pnpm run runtime:reset --confirm
```

`.env`はNodeの`--env-file`で実行時に読み込む。POSTGRES_URLの接続先にいる全Agentを対象とする。コマンドは環境ファイルを書き換えない。

- 保持: agents、agent_families、Bot設定・ペルソナ、migration履歴、設定ファイル
- 復元: agent_statesをconfig/initial-self/*.yamlの初期Self・Mood・Motiveへ戻す。獲得Disposition、Emotion、探索履歴、versionも初期化
- 削除: Event、Run、Tool実行、状態変更履歴、Memory、Social Context、Candidate、Scheduled Task、Web Snapshot、後処理、Outbox、受領記録、レート制限記録
- 自律スケジュール: autonomy-reviewを再作成。初回時刻は実行時刻＋AUTONOMY_REVIEW_INTERVAL_MS
- QUEUE_ROOTとWEB_ARCHIVE_ROOT: `.before-reset-<UUID>`を付けて退避。未設定時はvar/queueとvar/web-archive。安全のためプロジェクトのvar配下の独立したディレクトリだけを許可し、symlinkは拒否

全Agentに対応する初期Selfファイルが必要。Botと同じDBロックを取得できなければ変更せず終了する。
DB更新はtransaction内で行う。ファイル退避の通常エラーではDBと退避を戻す。ただしプロセス強制終了やCOMMIT時の通信断を含むDBとファイル間の完全な原子性は保証しない。

完了後は通常どおりBotを起動する。migrationやpersona:applyは不要。
Botごとに異なるQUEUE_ROOT/WEB_ARCHIVE_ROOTを使っている場合は、全ての保存先を別途整理する必要がある。
ファイルToolで作成した一般ファイル、logs、評価成果物、Discord投稿そのものは削除しない。
