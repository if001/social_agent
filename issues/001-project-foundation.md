---
created_at: 2026-10-02
status: created
---

# 001: Project foundationとtest harnessを構築する

## Goal

以後の実装を同じcommandと規約で開発・検証できるTypeScriptプロジェクト基盤を作る。

## Scope

- pnpm、TypeScript、Vitest、lint、buildの設定
- fast、integration、system、evaluation suiteの分離
- source / testの基本配置、temporary directoryとresource cleanup helper
- structured loggingの最小interface、artifactと秘密値の除外設定

## References

- `docs/IMPLEMENTATION_PLAN.md` IP-01
- `docs/TEST_STRATEGY.md` 4–6章

## Acceptance criteria

- [ ] `typecheck`、`lint`、`test`、`test:integration`、`test:system`、`verify`を実行できる
- [ ] 外部依存suiteは通常のfast testから分離されている
- [ ] `.env.sample`を保持し、秘密値や生成artifactをcommit対象から除外できる
- [ ] test終了後のtimer、subscription、file handle残存を検出できる

## Tests

- test runner、typecheck、lintの設定smoke test
- resource cleanup helperの振る舞いテスト

## Dependencies

なし。
