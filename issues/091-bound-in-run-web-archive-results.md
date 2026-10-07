---
created_at: 2026-10-07
status: done
---

# 091: 同一run内のWeb Archive本文取得を有界化する

## Background

Issue 089で`web_page`の戻り値からraw Markdownを除外し、Issue 090で過去runのraw Tool Resultを次回Contextから除外した。しかし、同一Deep Agent runでは`web_archive_read`の結果がそのままModel Call履歴へ残る。

実run `f2486b22-d983-469d-a18c-2c9842411f22`では、`web_page`の戻り値は364文字と402文字だった一方、要約失敗後に2件の`web_archive_read(maxCharacters: 8000)`が並列実行され、8,492文字と8,307文字のTool Resultが同一runへ追加された。5回目のModel Call後にAgent provider failedとなった。

## Dependencies

- Issue 089
- Issue 090

## Scope

- `web_archive_read`と`web_archive_grep`の1回あたりの既定値・最大出力を、Model Contextへ安全に入る範囲へ縮小する
- 同一runで複数回取得した場合もraw本文の累積量が上限を超えないようTool実行Contextで制御する
- Agentへ`web_archive_grep`、短い`web_archive_read`、offsetによる追加取得の順で必要箇所だけ読むよう説明する
- `web_page`のsummary生成失敗時に、元のprovider errorを構造化ログと保存エラーから追跡できるようにする
- summaryが空のSnapshotをAgentが無制限に精読しないfallbackを定義する
- 実装と`docs/`の「raw本文を後続Contextへ再投入しない」という記述を、同一run内の範囲取得まで含む形に修正する

## Out of scope

- raw Markdown file保存の廃止
- Web ArchiveのBot間共有方針の変更
- LLMを使わないsummary生成への変更
- Ollama Cloudモデル自体の推論速度改善

## Implementation notes

- `web_page`自体のTool Resultは既にmetadataだけであり、raw本文流入元は`web_archive_read`である。
- 現在の`web_archive_read`と`web_archive_grep`は既定8,000文字、最大16,000文字である。
- 単純な1回上限だけでなく、run contextにraw Web取得文字数を保持して累積上限を適用する。
- 要約処理は現在すべての例外を`Web page summarization failed`へ包むため、providerの具体的な原因を失っている。

## Acceptance criteria

- `web_page`後に複数Snapshotを参照しても、同一runへ追加されるraw Web本文が定義した累積上限以内になる
- Agentが既定で8,000文字単位の本文取得を行わない
- 過去runと同一runのどちらにも、ページ全文が暗黙に投入されない
- summary失敗時に原因となったprovider errorをログで識別できる
- Snapshot ID、offset、grepによる必要箇所の明示取得は維持される
- Bot間共有とfile-backed archiveは維持される

## Tests

- `web_archive_read`の既定値・最大値test
- 複数readの累積文字数上限test
- `web_archive_grep`の出力上限test
- summary失敗時のerror logging test
- `web_page` Tool Resultがraw Markdownを含まない回帰test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:system`

## References

- [Issue 089](./089-implement-shared-file-backed-web-archive.md)
- [Issue 090](./090-bound-agent-context-and-exclude-raw-tool-results.md)
- [Web Tool](../docs/web_tool.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
