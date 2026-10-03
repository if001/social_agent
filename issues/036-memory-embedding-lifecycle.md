---
created_at: 2026-10-04
status: created
---

# 036: Memory保存時Embeddingとbackfillを実装する

## Background

DBには`embedding vector(768)`と`embedding_model`があるが、通常CoreのMemory ProposalおよびSelf Change Memoryの保存処理はEmbeddingを生成・保存していない。そのため本番運用で蓄積したMemoryのvector類似度は常に0となる。

## Scope

- Issue 035で確定したdocsを先に確認し、必要なら実装詳細をdocsへ追記する。
- Memory確定時にEmbeddingを生成し、vectorとmodel識別子を同じMemoryへ保存する。
- 通常Memory、Self Change Memory、管理経路から保存するMemoryで同じlifecycleを適用する。
- Embedding未設定の既存Memoryを安全・冪等にbackfillする運用commandを追加する。
- dimension／model不一致、provider失敗、transaction境界、再試行方針を実装する。

## Out of scope

- Retrieval ranking全体の再設計。
- Memory内容をEmbedding用にLLMで要約する処理。
- Memory削除やcompaction。

## Implementation notes

- 外部Embedding呼び出しをDB transaction中に長時間保持しない構成を優先する。
- vectorと`embedding_model`は対として扱い、片方だけの保存を許さない。
- proposal確定とEmbedding失敗時にMemory全体を失うか、未Embedding状態で保存してbackfillするかをdocs契約に従って決める。

## Acceptance criteria

- [ ] 新規Memoryに正しいdimensionのEmbeddingとmodel識別子が保存される。
- [ ] Self Change Memoryにも同じ処理が適用される。
- [ ] 未Embedding Memoryだけを冪等にbackfillできる。
- [ ] 別AgentのMemoryを更新しない。
- [ ] provider失敗時の状態と再試行方法が明確である。

## Tests

- Fake Embedding Providerによるunit test。
- 実PostgreSQL／pgvectorで保存、backfill、再実行、Agent分離を確認するintegration test。
- dimension不一致とprovider失敗の回帰test。
- `pnpm typecheck && pnpm lint && pnpm test && pnpm test:integration`。

## Dependencies

- 035

## Plan reference

- [Implementation Design §16–17](../spec/personal-agent-implementation-design-v2.md)
- [Implementation Plan: Embedding・Retrieval・Context Builder](../docs/IMPLEMENTATION_PLAN.md)
