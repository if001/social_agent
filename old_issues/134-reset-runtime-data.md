---
created_at: 2026-10-11
status: done
---
# 134: 動作確認データのリセットコマンド

## Background
初期状態から検証を再開できるようユーザーがpnpmから実行する。
## Scope
DB蓄積データの削除、初期Self状態の復元、キュー・Webファイルの退避。
## Out of scope
実DBのリセット実行、一般ファイル・Discord投稿の削除。
## Implementation notes
[運用手順](../docs/RUNTIME_RESET.md)。Botロックとtransactionで競合を防ぐ。
## Acceptance criteria
初期設定は保持し、全Bot停止時だけリセット可能。初期Self不足は拒否。
## Tests
型検査、lint、一時DB schemaで復元・設定保持・稼働中拒否を確認。

## Results
型検査・lint成功。一時schemaで統合テスト成功。confirmなしの起動拒否確認済み。実DBのリセットはユーザーが実行する。
