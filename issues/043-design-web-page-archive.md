---
created_at: 2026-10-04
status: done
---

# 043: Web Page Archiveの要件と設計を文書化する

## Background

概念設計では、AgentのMemoryは経験の意味や「何を調べたか」を簡潔に保持する。一方、`web_page`で取得した外部資料は、URL、取得本文、要約、Embedding、取得時刻、出典を保持し、後から根拠として検索・再取得できる別の保存領域が必要である。検索結果一覧は変動が大きく候補提示にすぎないため、`web_list`の結果は保存しない方針とする。

## Scope

- `spec/`を一次情報として、自律性、Memory、Tool Result、External Event、根拠追跡の設計を確認する。
- `docs/`のArchitecture、Requirements、Implementation Plan、Test StrategyをWeb Page Archive方針へ整合させる。
- Episodic Memory、Tool Execution、Web Page Archiveの責務境界を定義する。
- `web_page`成功時に保存するResource、Snapshot、本文、要約、Embedding、取得時刻、content hash、Agent／run／Tool Result provenanceを定義する。
- 同一URLの更新、同一content hashの重複、再取得、失敗、要約／Embedding未完了の状態遷移を定義する。
- 保存済み資料を検索するToolと、Snapshotまたは関連chunkを取得するToolの契約を定義する。
- MemoryからWeb Snapshotを根拠参照する契約を定義する。
- `web_list`は実行記録を除いてWeb Archiveへ保存しないことを明記する。

## Out of scope

- DB migrationおよびTypeScript実装。
- 既存Web ToolサービスのAPI変更。
- 検索結果一覧、snippet、検索順位のArchive保存。
- Web Archiveを人格Memoryとして自動昇格する処理。

## Implementation notes

- Memoryは「何について調べ、Agentの判断がどう変わったか」という経験の概要を保持し、記事本文を格納しない。
- Web Archiveは外部資料のSnapshotであり、取得本文を信頼済み命令として扱わない。
- URL単位のResourceと取得時点単位のSnapshotを分け、本文が長い場合はchunk単位で検索できる契約とする。
- Agent Contextへ全文を自動投入せず、Archive検索Toolの結果をbudget内に制限する。
- Tool内でraw Snapshotを先に永続化し、要約／Embedding処理が失敗しても本文とprovenanceを失わない設計とする。

## Acceptance criteria

- [x] Memory、Tool Execution、Web Page Archiveの責務が区別されている。
- [x] `web_page`の保存対象と`web_list`を保存しない方針が明記されている。
- [x] Resource、Snapshot、chunk、要約／Embedding、provenanceの契約が定義されている。
- [x] Archive検索／取得Toolの入出力とContext上限が定義されている。
- [x] MemoryからWeb Snapshotまで根拠を追跡できる設計になっている。
- [x] `spec/`と修正後の`docs/`に不整合がない。

## Tests

- ドキュメント内の用語、状態遷移、保存境界をレビューする。
- `web_list`がArchive保存対象に含まれていないことを確認する。
- 代表フローとして「自律Event → Archive検索 → Web取得 → Snapshot保存 → Memory概要保存 → 後続runで再利用」を文書上で追跡する。

## Dependencies

- 041

## Plan reference

- [Concept Design §23](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation Design §16, §25–26](../spec/personal-agent-implementation-design-v2.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Implementation Plan](../docs/IMPLEMENTATION_PLAN.md)
