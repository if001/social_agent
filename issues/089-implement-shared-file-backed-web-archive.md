---
created_at: 2026-10-07
status: done
---

# 089: 共有ファイル型Web ArchiveとLLM summary検索を実装する

## Background

Issue 088で確定した設計に基づき、Web pageのraw MarkdownをDBから共有ファイルへ移し、LLM summaryとembeddingを検索用metadataとして保存する。`web_page`はbounded metadataだけを返し、Bot間で同じArchiveを検索・参照できるようにする。

## Dependencies

- Issue 088

## Scope

- Issue 088のdocsを実装前に再確認する
- 共有Web Archive rootと安全なSnapshot file pathを設定する
- 一時ファイル、atomic rename、content hash、孤立file回復を実装する
- Web Snapshot schemaをfile path、約400文字summary、summary embedding、処理状態へ変更する
- Agent所有権filterを削除し、取得Agent / run / event / tool provenanceを保持する
- Tool loopを持たない用途別LLM structured callでsummaryを生成する
- summary生成、embedding生成の有限retryとbackfillを実装する
- `web_page`結果をSnapshot ID、URL、title、summary、参照情報へ限定する
- `web_archive_search`をsummary embeddingとkeyword一致のrerankへ変更する
- Snapshot IDによるbounded read / grep Toolを実装する
- Bot Aが保存したSnapshotをBot Bが検索・参照できるようにする
- 空DB向けDrizzle migrationを生成する

## Out of scope

- 既存Web Snapshotデータの移行
- S3等の外部Object Storage
- raw本文全体のembedding
- 任意filesystem pathの公開

## Implementation notes

- summaryは400文字程度を上限とし、URLや本文を捏造しないよう入力と出力を検証する。
- raw file保存成功とDB metadata commitは回復可能な状態遷移で接続する。
- read / grepはSnapshot IDからDB登録pathを解決し、共有root外を拒否する。
- Tool Resultと実行記録にはraw本文を保存しない。

## Acceptance criteria

- raw Markdownが共有rootのSnapshot fileとして保存される
- DBにraw本文を複製せず、summaryとembeddingを保存する
- `web_page`結果がboundedでraw本文を含まない
- Botをまたいでsemantic＋keyword検索と本文参照ができる
- grep / readが必要箇所だけを上限内で返す
- summaryまたはembedding失敗を再処理できる
- path traversalと未登録file参照を拒否する

## Tests

- atomic file write、dedup、本文変更、孤立file回復test
- LLM summaryの約400文字上限・Schema・retry test
- summary embedding lifecycle test
- semantic＋keyword rerank test
- cross-Bot search / read integration test
- read / grep上限とpath traversal test
- `web_page` result sizeとraw本文非包含test
- `pnpm db:generate`差分確認
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:system`

## References

- [Issue 088](./088-align-docs-for-shared-file-backed-web-archive.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Web Tool contract](../docs/web_tool.md)
