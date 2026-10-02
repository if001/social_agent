---
created_at: 2026-10-02
status: created
---

# 015: 決定的System suiteと運用CLIを完成させる

## Goal

全決定的フローと異常系をrelease前に1 commandで再現できるようにする。

## Scope

- ST-01〜ST-07 fixtureとprocess test harness
- migration、seed / agent初期化、dead-letter操作CLI
- health / readiness表示、backup対象、artifact metadata
- Manual Smoke手順

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-15
- `docs/TEST_STRATEGY.md` 10、13、17、19章

## Acceptance criteria

- [ ] `pnpm verify`でStatic、Unit、Contract、Integration、ST-01〜ST-07が成功する
- [ ] 不正Schema、禁止長期更新、未知Tool、別Agent参照が副作用を残さない
- [ ] migration、agent初期化、dead-letter操作をCLIから実行できる
- [ ] Terminal、Discord、複数botのManual Smoke手順が再現可能である
- [ ] test後にprocess、timer、subscription、file handleを残さない

## Tests

- 実PostgreSQL / File QueueとFake Harness / Web / Discordを使うST-01〜ST-07
- CLIとartifact metadataの振る舞いテスト

## Dependencies

- 010
- 011
- 012
- 013
- 014
