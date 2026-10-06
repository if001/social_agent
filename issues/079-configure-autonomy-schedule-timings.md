---
created_at: 2026-10-06
status: done
---

# 079: 自律行動の時間設定を環境変数へ統合する

## Background

Schedulerの走査間隔だけが環境変数で、各review、Drive、retry、leaseはコードとSQLに固定されていた。

## Scope

- 自律処理の時間設定を用途別の環境変数へ分離する
- `.env.sample`へ単位と用途のコメントを追加する
- Agent初期化、Drive保存、Scheduler再設定、失敗時retry、leaseへ同じ設定を配線する
- docsとtestを更新する

## Acceptance criteria

- すべての時間設定を環境変数から変更できる
- 各変数の用途が`.env.sample`で分かる
- Autonomy、State、Memory、Driveの間隔が独立している
- typecheck、lint、unit、integration、systemが成功する
