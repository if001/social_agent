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
