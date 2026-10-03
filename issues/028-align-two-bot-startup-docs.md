---
created_at: 2026-10-03
status: created
---

# 028: specを基準に2 bot起動のdocsを整合させる

## Goal

1 botを1 Agent processとして2つ起動する構成、設定、起動停止、共有資源と分離境界を、specを一次情報としてdocsへ確定する。

## Scope

- `spec/`のRuntime、複数bot、Internal Event、Tool、永続化の記述を一次情報として整理する。
- `docs/ARCHITECTURE.md`、`REQUIREMENTS.md`、`IMPLEMENTATION_PLAN.md`、`TEST_STRATEGY.md`、`MANUAL_SMOKE.md`の不整合と不足を修正する。
- 1 process＝1 Agent、共有PostgreSQL／Queue／Ollama、Agent IDとQueue destinationによる分離を明記する。
- migration、agent初期化、capability check、ready判定、SIGINT／SIGTERM、drain、再起動復旧の順序を明記する。
- 2 bot分の資格情報を`.env`の内容を露出せずプロセス別に渡す方式を決める。
- Discord owner／guild／channel allowlist、自律Actionの既定配送先を設定契約へ反映する。

## Out of scope

- 実装変更
- 実Discordへの接続
- `.env`の変更または内容表示

## Acceptance criteria

- [ ] specとの対応箇所と採用判断がdocsから追跡できる。
- [ ] 2 botの起動コマンド、設定分離、共有資源、停止手順が一意に理解できる。
- [ ] docs間でBot Host、Runtime、Scheduler、Discord、Outboxの責務が矛盾しない。
- [ ] `.env.sample`以外のenvファイルを変更しない方針が明記される。

## Tests

- 文書内リンク、設定名、起動順序、責務表の静的確認。

## References

- [概念設計](../spec/personal-agent-concept-design-restructured-v2.md)
- [実装設計](../spec/personal-agent-implementation-design-v2.md) 27章ほか

