---
created_at: 2026-10-04
status: created
---

# 036: Memory生成・Embedding lifecycleとbackfillを実装する

## Background

DBには`embedding vector(768)`と`embedding_model`があるが、通常CoreのMemory ProposalおよびSelf Change Memoryの保存処理はEmbeddingを生成・保存していない。そのため本番運用で蓄積したMemoryのvector類似度は常に0となる。

## Scope

- Issue 035で確定したdocsを先に確認し、必要なら実装詳細をdocsへ追記する。
- 通常Agent Coreが現在Eventと直近対話から重要なEpisodic Memoryを0件以上提案し、Semantic／Self-relatedは根拠付きCandidateとして提案する契約を実装する。
- RuntimeでID、所有Agent、時刻、出典、参照所有権、重複を検証し、MemoryまたはCandidateを保存する。
- 検証済みMemoryを`pending`で確定後、DB transaction外でEmbeddingを生成し、成功時に`ready`へ更新する。
- 通常Memory、Self Change Memory、管理経路から保存するMemoryで同じlifecycleを適用する。
- Embedding未設定の既存Memoryを安全・冪等にbackfillする運用commandを追加する。
- dimension／model不一致、`pending | ready | failed`、provider失敗、transaction境界、再試行方針を実装する。

## Out of scope

- Retrieval ranking全体の再設計。
- Memory内容をEmbedding用にLLMで要約する処理。
- Memory削除やcompaction。

## Implementation notes

- 外部Embedding呼び出しをDB transaction中に長時間保持しない構成を優先する。
- vectorと`embedding_model`は対として扱い、片方だけの保存を許さない。
- Embedding失敗時もMemory本文と出典を保持し、状態と失敗情報を残してbackfill可能にする。

## Acceptance criteria

- [ ] 新規Memoryに正しいdimensionのEmbeddingとmodel識別子が保存される。
- [ ] 通常runが重要なEpisodic Memoryだけを保存し、Semantic／Self-relatedを直接確定しない。
- [ ] MemoryとCandidateから根拠Event／Memoryおよび出典を追跡でき、重複提案を再保存しない。
- [ ] Self Change Memoryにも同じ処理が適用される。
- [ ] 未Embedding Memoryだけを冪等にbackfillできる。
- [ ] 別AgentのMemoryを更新しない。
- [ ] provider失敗時の状態と再試行方法が明確である。
- [ ] Embedding外部呼び出し中にMemory保存transactionを保持しない。

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
