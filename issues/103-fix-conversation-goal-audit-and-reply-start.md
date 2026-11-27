---
created_at: 2026-11-27
status: done
type: fix
plan: []
requirements: [FR-90, FR-94, NFR-8, NFR-17]
requires: agent
---

# 103 Conversation Goal の監査正本と開始条件を修正する

元計画：#102 マージ後の PostgreSQL integration test 失敗調査

## Background

`conversation_goal` は `observation_gate_decisions` の正本ではない。Goal Composer の監査は `conversation_goal_compositions`、開始した会話のGoalは `conversations.goal` に保存する。しかし Integration test は旧列を期待していたため、Conversation Goal の正本へ保存されていないように見えた。

調査中に、channel の通常投稿も reply と同じ外部発話として Conversation を開始する実装も見つかった。Conversation は外部 message ID を持つ返信で開始し、`recipient: channel` / `recipient: user` の配送は既存Goalを置換・開始・closeしない。

## Scope

- Composer 監査を `conversation_goal_compositions` に保存・検証する Integration test へ更新する。
- Gate decision の旧 `conversation_goal` 列を正本として参照しない。
- Conversation の開始を、返信元 message ID を持つ外部返信だけに限定する。
- テスト DB の runtime role に `conversation_goal_compositions` の DML 権限を付与する grant script を修正する。

## Out of scope

- 旧 `observation_gate_decisions.conversation_goal` 列の削除。既存 migration / schema 整理の別作業で扱う。
- Conversation Goal Composer の入力・推論方針の変更。

## Acceptance criteria

- [x] FR-94：Conversation Goal は `conversations.goal`、Composer監査は `conversation_goal_compositions` を正本とする。
- [x] FR-94：`recipient: channel` の通常投稿は Conversation を開始しない。
- [x] NFR-8：Conversation と Composer監査は同じ Event transaction で原子的に保存される。
- [x] NFR-17：runtime role は Composer監査テーブルへ必要な DML 権限を持つ。
- [x] 差分が正の文書に反映済み、又は既存 FR-90 / FR-94 / ADR-26 で充足されている。

## Tests

- `pnpm typecheck`
- `pnpm db:grant:conversations:test`
- `tests/integration/persistence.test.ts`（56 tests）
