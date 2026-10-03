---
created_at: 2026-10-03
status: created
---

# 030: 1 process 1 Agentの起動設定とCLI契約を実装する

## Goal

同じbuildを異なる設定で2 process起動でき、外部接続前に各botの設定を安全に確定できるようにする。

## Scope

- `bot:start`相当のCLI入口とprocess別設定指定を実装する。
- BOT_ID、Discord資格情報、owner／guild／channel allowlist、Queue root、File root、自律Action宛先、Scheduler間隔をZod検証する。
- `.env.sample → .env → process.env`の既存優先順位を維持し、明示したprocess別設定方式を追加する。
- 秘密値をlog、error、artifactへ出さない。
- migrationは起動時に暗黙実行せず、明示commandのままとする。

## Acceptance criteria

- [ ] 2つの設定から異なるBOT_IDとDiscord資格情報を持つprocessを構成できる。
- [ ] 不足・矛盾・同一BOT_IDの誤構成を外部接続前に拒否できる。
- [ ] `.env`を変更せず、必要なsample項目は`.env.sample`だけへ追加される。
- [ ] 秘密値が出力されないことをテストで確認できる。

## Dependencies

- 029

