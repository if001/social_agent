web検索のサービスは以下です。
SIMPLE_CLIENT_BASE_URLを環境変数から読み取ってください。

このサービスはTool Registry経由でDeep Agentへ登録する。入力検証、deadline、呼び出し上限、実行記録はRuntimeが与えるTool実行境界で強制し、結果は同じDeep Agent runのreasoningへ返す。

## web_list
queryで検索を行いリストを返却します。

POST: base_url/list
pyaload: {"q": q, "k": k}
return: ListResponse

class ListResponse(BaseModel):
    query: str
    k: int
    results: List[SearchResult]

@dataclass(frozen=True)
class SearchResult:
    rank: int
    title: str
    url: str
    snippet: Optional[str] = None
    published_date: Optional[str] = None


## web_page
あるurlでページの内容をmarkdownで取得します。

POST: base_url/page
payload: {"urls": string}
return: PageResponse

class PageResponse(BaseModel):
    docs: List[DocOut]

class DocOut(BaseModel):
    url: str
    title: str
    markdown: str

`markdown`はWeb Tool ServiceからArchive adapterまでの入力契約である。Adapterはraw Markdownを共有Archive fileへ保存し、Deep Agentへは次のbounded resultだけを返す。

```json
{
  "documents": [
    {
      "snapshotId": "snapshot-id",
      "url": "https://example.com/page",
      "title": "ページタイトル",
      "summary": "LLMが生成した約400文字以内の日本語要約",
      "reference": { "type": "web-snapshot", "id": "snapshot-id" }
    }
  ]
}
```

SnapshotはBot間共有であり、取得Botとは別のBotも`web_archive_search`、`web_archive_read`、`web_archive_grep`から参照できる。raw Markdownや全chunkをTool Resultへ含めない。本文確認は`web_archive_grep`を優先し、`web_archive_read`はoffsetを指定した最大2,000文字の範囲取得に限定する。同一Agent runで返せるraw本文は合計6,000文字までとし、複数Tool CallによるContext肥大を防ぐ。
