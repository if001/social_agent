---
created_at: 2026-10-05
status: done
---

# 066: 安全化した具体的なエラー内容を標準出力へ記録する

## Background

Runtime componentの失敗が`errorCode: UNKNOWN`だけでは、欠落tableや外部接続失敗の原因を起動中に判別できない。

## Scope

- Error名、code、安全化したmessageを構造化logへ追加する。
- PostgreSQLのSQLSTATE、schema、table、column、constraint、routineを可能な範囲で追加する。
- Bot Host、Scheduler、Agent Core、Toolの失敗へ共通処理を適用する。
- 認証情報をmessageからマスクする。

## Out of scope

- stack、cause、SQL本文、Prompt、Tool入出力の標準出力。
- 外部logサービスへの送信。

## Implementation notes

- URL userinfo、Bearer token、token／password／API key等の代入表現をマスクする。
- messageは改行を除き、最大1,000文字へ制限する。
- DomainErrorとPostgreSQL Errorのcodeを共通`errorCode`として扱う。

## Acceptance criteria

- [x] component失敗の具体的なmessageとcodeを確認できる。
- [x] PostgreSQLの欠落relationをSQLSTATE付きで識別できる。
- [x] 資格情報、stack、causeを出力しない。

## Tests

- PostgreSQL風Errorのmetadataとmessageを確認するunit test。
- URL credential、Bearer token、passwordのredaction test。
- typecheck、lint、unit、system、PostgreSQL integration test。

## Plan reference

- [Issue 065](./065-runtime-stdout-observability.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Requirements](../docs/REQUIREMENTS.md)
