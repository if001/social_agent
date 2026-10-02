---
created_at: 2026-10-02
status: created
---

# 007: Agent HarnessとOllama Cloud Chat Adapterを実装する

## Goal

Domain契約を保ってDeep Agentsのreasoning、Tool Loop、構造化出力を利用する。

## Scope

- Scripted Agent HarnessとDeep Agents Adapter
- Ollama Cloud Chat接続、認証、model設定、capability check
- prompt version、Tool Registry変換、trace、deadline / abort / step上限
- output parseと1回だけの構造修復

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-07
- `docs/ARCHITECTURE.md` 5.6、9章
- `.env.sample`

## Acceptance criteria

- [ ] Deep Agents / LangChain型をadapter外へ漏らさない
- [ ] Registryに存在するToolだけをmodelへ公開する
- [ ] timeout、abort、不正出力を共通errorへ変換する
- [ ] repairは設定上限を超えて繰り返さない
- [ ] Cloud認証情報をlog、trace、artifactへ残さない

## Tests

- Scripted Harnessと実adapterへ適用可能なAgentHarness contract
- 正常出力、Tool trace、timeout、abort、repair成功 / 失敗、未知Tool

## Dependencies

- 002
- 003
