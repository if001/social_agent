---
created_at: 2026-10-05
status: done
---

# 065: botの処理stepを標準出力へ記録する

## Background

Discord botの動作確認時に、Eventを受信したか、Context構築・Agent Core・Tool・commit・配送のどこを処理中か判断できる標準出力logが必要である。

## Scope

- 本番botへJSON Lines Loggerを配線する。
- 起動、Discord、Runtime、Agent Core、Tool、Scheduler、Outbox、停止を記録する。
- ID、種別、件数、成否、所要時間を記録する。
- 本文や秘密情報を標準出力へ出さない。

## Out of scope

- Prompt、Memory、Tool入出力本文の出力。
- 外部log集約サービスとの連携。
- DBに保存済みの監査traceの置換。

## Implementation notes

- 1行1 JSON objectとして出力し、複数botのlogを`botId`で識別する。
- test compositionは既定でnoop Loggerを使用する。
- errorは分類codeだけを出し、provider error本文を出さない。

## Acceptance criteria

- [x] bot起動から停止まで主要stepを確認できる。
- [x] Event、run、Tool、配送をIDで対応付けられる。
- [x] 入力本文、Prompt、Memory本文、資格情報を出力しない。
- [x] 既存処理とテスト結果を変更しない。

## Tests

- JSON Lines形式とchild contextのunit test。
- RuntimeからOutboxまでのstepを確認するsystem test。
- typecheck、lint、unit、system、PostgreSQL integration test。

## Plan reference

- [Architecture: Observability](../docs/ARCHITECTURE.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
