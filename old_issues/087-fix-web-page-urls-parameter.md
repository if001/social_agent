---
created_at: 2026-10-07
status: done
---

# 087: web_pageの入力parameterをurlsへ統一する

## Background

Web Tool Serviceの`POST /page`は`{"urls": string}`を要求するが、現在のTool Registryは`{"url": string}`をDeep Agentへ公開し、そのpayloadを送信している。実運用では`web_page`がHTTP 422を返しており、このrequest contract不一致が原因と考えられる。

## Scope

- `web_page`の登録Schemaを必須の`urls`へ変更する
- `POST /page`へ`{"urls": string}`を送信する
- `url`入力の後方互換処理は残さない
- ArchitectureとTest Strategyのrequest contractを修正する
- unit、system、integration testのTool入力を`urls`へ更新する
- Agentへ公開されるJSON SchemaとHTTP bodyのfield名を検証する

## Out of scope

- Web Tool Service本体の変更
- Page response schemaの変更
- 複数URL配列への拡張
- Archive保存形式の変更

## Implementation notes

- `urls`という複数形だが、現行サービス契約の値は単一のHTTP(S) URL文字列である。
- Tool RegistryのZod schemaを正本とし、Deep Agentへ同じJSON Schemaを公開する。

## Acceptance criteria

- Deep Agentが`web_page`の必須parameterとして`urls`を認識する
- Adapterが`POST /page`へ`{"urls": "https://..."}`を送信する
- `url`またはHTTP(S)以外の値は副作用前に拒否される
- 正常なPage responseは従来どおりArchiveへ保存される

## Tests

- 公開JSON Schemaのrequired field test
- HTTP request body contract test
- 旧`url`拒否test
- Archive integration回帰test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:system`

## References

- [Web Tool contract](../docs/web_tool.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
- [Issue 044](./044-implement-reusable-web-page-archive.md)
