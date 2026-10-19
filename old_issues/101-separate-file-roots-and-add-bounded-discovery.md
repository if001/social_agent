---
created_at: 2026-10-08
status: done
---

# 101: File Toolの権限rootを分離し有界な探索・部分読込を追加する

## Background

現在のFile Toolはread、write、deleteが同じ`FILE_TOOL_ROOTS`を共有し、`file_read`はファイル全文をTool Resultへ返す。ディレクトリ一覧、名前検索、本文検索もなく、大きなファイルを直接読むとDeep AgentのContextを圧迫する。

## Dependencies

- なし

## Scope

- read系とwrite/delete系の許可rootを別設定にする
- `FILE_READ_ROOTS`と`FILE_WRITE_ROOTS`を導入し、旧`FILE_TOOL_ROOTS`を削除する
- root番号と実パスの対応をTool descriptionへ含める
- `file_read`をhead、tail、行範囲による有界な部分取得へ変更する
- `file_list`で指定ディレクトリ直下を有界に一覧する
- `file_find`で名前を深度・件数制限付きで再帰検索する
- `file_grep`でテキスト本文の一致行と有限の前後文脈を返す
- 絶対path、`..`、root外symlinkを拒否する
- `.env.sample`とdocsを更新する

## Out of scope

- shellコマンドの公開
- binary fileの内容解析
- 正規表現実行
- File Tool結果の永続Memory化

## Implementation notes

- list/find/grep/readはread rootsだけを使い、write/deleteはwrite rootsだけを使う。
- grepは文字列のliteral一致とし、探索file数、file size、match数、出力文字数を制限する。
- symlinkは一覧上識別できるが、再帰探索では辿らない。
- Tool Resultにホスト上の許可root絶対pathを含めない。

## Acceptance criteria

- read rootにあるファイルをwrite/deleteできない
- write rootにあるファイルを、read rootにも設定しない限りread/list/find/grepできない
- `file_read`がファイル全文を無制限に返さない
- Agentがlist、find、grep、範囲readで必要箇所を段階的に取得できる
- root escapeとroot外symlinkがすべてのToolで拒否または非追跡になる
- 各Tool Resultが設定された件数・文字数上限内に収まる

## Tests

- read/write root分離test
- head、tail、range取得と文字数上限test
- list/find/grepの結果、深度、件数、文字数上限test
- `..`、絶対path、root外symlink拒否test
- config読込test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:system`

## References

- [Architecture: Tool Registry](../docs/ARCHITECTURE.md)
- [Requirements: Tool](../docs/REQUIREMENTS.md)
