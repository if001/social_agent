---
created_at: 2026-10-02
status: created
---

# 008: Local Embedding、hybrid retrieval、Context Builderを実装する

## Goal

個体分離とContext budgetを守り、現在の判断に必要な状態とMemoryだけを選択する。

## Scope

- Fake / Local Ollama Embedding Providerとmodel metadata
- embedding dimension検証
- PostgreSQL全文検索、pgvector、metadata filter、順位調整
- 関連Self、dynamic state、Social Context、Intentionの選択とbudget制御

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-08
- `docs/ARCHITECTURE.md` 5.5、5.8
- `docs/TEST_STRATEGY.md` 7.3、9.3
- `.env.sample`

## Acceptance criteria

- [ ] Chat用Cloud接続やAPI keyをEmbeddingに使用しない
- [ ] model / dimension不一致を保存前に検出する
- [ ] lexicalとsemantic検索、metadata filterを組み合わせる
- [ ] 別AgentのMemory、category上限、token budget超過をContextへ含めない
- [ ] 同じfixtureでは安定したtie-breakになる

## Tests

- 固定vectorと既知datasetによるretrieval integration test
- ContextBuilderのpublic outputに対する選択・budget・個体分離テスト

## Dependencies

- 002
- 004
