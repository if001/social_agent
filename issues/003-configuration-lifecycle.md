---
created_at: 2026-10-02
status: done
---

# 003: Configurationとprocess lifecycleを実装する

## Goal

外部接続前に設定を安全に確定し、決定的な時刻・IDとgraceful shutdownを提供する。

## Scope

- `.env.sample → .env → process.env`の読み込みとZod検証
- Ollama Cloud Chat、Local Embedding、Web Tool、DB、Queue、Discord等の設定group
- Clock / IDのproduction実装とtest double
- lifecycle state、AbortSignal、log contextとsecret redaction

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-03
- `.env.sample`
- `docs/ARCHITECTURE.md` 5.1、13、14.3、16章

## Acceptance criteria

- [ ] 不正・不足・矛盾した設定では外部接続前に終了する
- [ ] ChatとEmbeddingの接続先、model、認証を分離する
- [ ] `SIMPLE_CLIENT_BASE_URL`とEmbedding dimensionを検証する
- [ ] `OLLAMA_API_KEY`等をlogへ出さない
- [ ] testからClockとIDを固定でき、停止中は新規受付しない

## Tests

- 設定優先順位とSchema境界
- secret redaction
- `starting / ready / degraded / stopping`遷移

## Dependencies

- 001
- 002
