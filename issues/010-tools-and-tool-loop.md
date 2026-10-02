---
created_at: 2026-10-02
status: created
---

# 010: Tool Registry、Web／File Tool、Tool Loopを実装する

## Goal

Agentが登録済みCapabilityだけを権限と実行上限の範囲で利用できるようにする。

## Scope

- Tool Registry、execution context、idempotency key、共通結果
- `SIMPLE_CLIENT_BASE_URL`の`POST /list`と`POST /page`へ接続するAdapter
- `file_read`、`file_write`、`file_delete`のroot制約
- Runtime内Tool Result再投入とstep / call / deadline上限

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-10
- `docs/ARCHITECTURE.md` 5.7、8.2、16章
- `docs/web_tool.md`
- `.env.sample`

## Acceptance criteria

- [ ] 未登録Toolと不正入力を副作用前に拒否する
- [ ] Web request / responseをSchema検証し、契約外responseを共通errorにする
- [ ] service requestを構成済みbase URLだけへ送り、page URLはHTTP(S)だけを許可する
- [ ] File Toolは`..`、absolute path、symlink等によるroot外accessを拒否する
- [ ] Tool Resultを外部Queueへ出さず、同じrun内で再解釈する
- [ ] Tool失敗をAgentが再判断でき、上限で必ず停止する

## Tests

- Web fixture serverによる正常、timeout、HTTP error、size、不正JSON、Schema不適合
- File Toolの許可root境界
- ST-03 Tool Loop

## Dependencies

- 005
- 007
- 009
