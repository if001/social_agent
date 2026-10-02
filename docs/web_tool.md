web検索のサービスは以下です。
SIMPLE_CLIENT_BASE_URLを環境変数から読み取ってください。

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
payload: {"url": url}
return: PageResponse

class PageResponse(BaseModel):
    docs: List[DocOut]

class DocOut(BaseModel):
    url: str
    title: str
    markdown: str
