---
created_at: 2026-10-07
status: done
---

# 092: Deep AgentのTool履歴を圧縮する

## Background

同一runではTool ResultがすべてToolMessageとして後続Model Callへ再送される。ChatOllamaはmodel profileに最大入力token数を公開せず、Deep Agentsの既定Summarizationは約170,000 tokenまで発火しない。最新runでは`web_page`のsummary自体は221文字と288文字だったが、重複metadataを含む結果全体は633文字と581文字だった。

## Scope

- Deep AgentsのSummarization Middlewareへ明示的なtoken発火点を設定する
- 後続Model Callへ渡す使用済みTool Resultを、Toolごとの短いprojectionへ置換する
- DBへ保存する完全なTool実行記録は維持する
- `web_page`成功結果をURL、title、summary、snapshotIdへ限定する
- Model Callの入力概算token数とOllama usage／終了metadataをログへ追加する
- 空の最終出力を明示的に診断できるようにする
- 関連ドキュメントを更新する

## Out of scope

- `numCtx`、`numPredict`の明示設定
- Web Snapshotの保存形式変更
- Agent CoreとTool Loopの分離

## Implementation notes

- Tool CallとTool Messageの対応関係は維持したままcontentだけを圧縮する。
- 最新Tool Resultは直後の判断に必要なため保持し、過去のResultから圧縮する。
- `web_page`の失敗statusは診断に必要な場合だけ返す。

## Acceptance criteria

- 複数Tool Call後も後続Model CallのTool Resultが有界である
- Web本文、検索snippet、重複metadataが履歴へ累積しない
- 監査用`tool_executions.result`には実際の結果が残る
- `web_page`成功結果に重複したreferenceとstatusが含まれない
- Summarizationがモデルprofileなしでも明示した閾値で発火できる
- 空出力のログから入力規模と終了metadataを確認できる

## Tests

- Tool Message projection test
- `web_page`結果contract test
- Summarization設定test
- Model response metadata logging test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:system`

## References

- [Issue 090](./090-bound-agent-context-and-exclude-raw-tool-results.md)
- [Issue 091](./091-bound-in-run-web-archive-results.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Web Tool](../docs/web_tool.md)
