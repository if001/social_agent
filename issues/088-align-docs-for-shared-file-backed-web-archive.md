---
created_at: 2026-10-07
status: done
---

# 088: 共有ファイル型Web Archiveの設計をdocsへ反映する

## Background

現在の設計はWeb pageのraw MarkdownをDBへ保存し、SnapshotをAgent所有として分離する。一方、採用方針ではraw Markdownをファイルとして保存し、LLMが約400文字へ要約したsummaryとembeddingをDBへ保存する。保存した記事はBot間で共有し、どのBotも検索・参照できるResourceとする。

## Dependencies

- Issue 087

## Scope

- `spec/`を一次情報として変更影響を確認する
- Requirements、Architecture、Test Strategy、Implementation Plan、Web Tool contractを更新する
- raw Markdown、DB metadata、summary embeddingの正本境界を定義する
- Web ArchiveをBot間共有Resourceとして定義し、取得主体のprovenanceと参照権限を分離する
- LLMによる約400文字の日本語summary契約、失敗・retry・backfillを定義する
- semantic similarityとtitle / summary / URLのkeyword一致を組み合わせた検索・rerankを定義する
- Snapshot IDから安全に本文を検索・部分取得するTool契約を定義する
- `web_page`がDeep Agentへ返すbounded resultを定義する
- raw Tool ResultをRecent Observationへ再投入しないContext方針を定義する

## Out of scope

- コード、migration、ファイルの実装
- 既存DBデータの移行保証
- 外部Object Storage

## Implementation notes

- `agent_id`は所有権ではなく取得元provenanceとして残すか、別fieldへ改名する。
- ファイル参照は任意pathではなくSnapshot IDを公開境界にする。
- raw MarkdownはLLM promptやTool Resultへ含めない。
- summary生成は決定的抽出へfallbackせず、失敗状態として有限回retry可能にする。

## Acceptance criteria

- Bot Aが保存したSnapshotをBot Bが検索・参照できる
- raw Markdown、summary、embedding、provenanceの保存先と責務が明確である
- `web_page`結果にraw本文を含めない契約が明記される
- 検索、grep、部分取得の上限とpath安全性が明記される
- docs間にAgent所有と共有Resourceの矛盾が残らない

## Tests

- docs内のWeb Archive所有権・payload・保存形式の整合確認
- shared search、bounded Tool Result、summary failure、file recoveryのTest Strategy追加

## References

- [Concept implementation design](../spec/personal-agent-implementation-design-v2.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
- [Web Tool contract](../docs/web_tool.md)
- [Issue 087](./087-fix-web-page-urls-parameter.md)
