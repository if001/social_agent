---
created_at: 2026-11-27
status: done
type: change
plan: []
requirements: [C-17, C-23, FR-17, FR-18, FR-19, FR-45]
requires: agent
---

# 102 Agent Core の評価・Action 出力を最小化する

元計画：2026-11-27 の Agent Core 出力レビュー

## Background

Agent Core の flat structured output は `meaning`、`feeling`、`desire`、`actionType`、`content`、`recipient`、`reason`、`refusalBasis` を持つ。`meaning` は次 Event の補助入力以外に状態遷移上の消費者がなく、`refusalBasis` は監査記録以外で参照されない。`refuse` と `notify-no-execution` は配送動作が `respond` と同一である。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|
| MODIFIED | C-23 | Agent Core の評価を Feeling のみにし、Meaning を出力・継続入力から除く | spec/personal-agent-implementation-design-v2.md |
| MODIFIED | C-17 | 最終 Action を `respond` と `no-external-action` の二種へ縮小する | spec/personal-agent-concept-design-restructured-v2.md |
| MODIFIED | FR-17 | `respond` のみを配送 Action とし、拒否・非実行通知は本文表現として扱う | docs/REQUIREMENTS.md |
| MODIFIED | FR-18, FR-19 | 拒否・非実行を`respond`へ統合し、Action集合を二種に縮小する | docs/REQUIREMENTS.md |
| MODIFIED | FR-45 | idle は `respond` を必須とする | docs/REQUIREMENTS.md |

## Scope

- Agent Core の Assessment を `feeling?` だけにする。
- FinalAction を `respond` と `no-external-action` に縮小する。
- `respond` は拒否・保留・非実行の本文も表現できる。
- `recipient` は `respond` の配送先 override として維持する。
- `reason` は `no-external-action` の会話終了・監査理由として維持する。
- 旧 Action / Meaning の互換変換は追加しない。

## Out of scope

- Experience Integration の責務変更。
- recipient の配送設計変更。
- 既存 Agent Run JSON の移行。

## Implementation notes

- flat output の `actionType` は LLM 向け表現として維持し、許可値を二つにする。Runtime の domain action は `type` を使う。
- `refuse` と `notify-no-execution` を、Action 種別ではなく `respond.content` の意味表現へ統合する。
- `previousAssessment` は直近の Feeling だけを時刻付きで渡す。

## Acceptance criteria

- [x] C-23：Meaning を Agent Core の入力・出力・保存契約から除去し、Feeling だけを短期評価として扱う。
- [x] C-17：最終 Action は `respond` と `no-external-action` のみである。
- [x] FR-17：拒否・保留・非実行通知も `respond` の一配送本文として処理される。
- [x] FR-45：idle は `respond` を必須とし、`no-external-action` を選べない。
- [x] 一次仕様、docs、prompt / skill / schema description、評価、テストに旧 Action 用語を残さない。
- [x] 差分が正の文書に反映されている。
- [x] 上流への反映がすべて反映済みである。

## Tests

- C-23：Agent Harness が Feeling を含む / 含まない出力を受理し、Meaning を拒否する。
- C-17, FR-17：`respond` が通常発話・拒否内容・非実行通知内容を同じ配送経路で配送する。
- FR-45：idle の `no-external-action` を Runtime / Harness が拒否する。
- `pnpm typecheck`
- `pnpm test`

## 実装メモ

- `meaning` は Event Experience と Memory の責務へ寄せ、Agent Core の短期評価は Feeling のみとした。
- `respond` と `no-external-action` の二種へ縮小し、拒否・保留・非実行を配送する場合は `respond.content` で表す。
- #101 の部分コミットで残っていた Experience Integration の `nextMood` 参照も併せて修正した。
- 過去 Issue のコミット漏れだった Event Experience / Event Projection の正本フィールド（agent、kind、content、subjects、occurredAt）の永続化も統合した。
- 検証：`pnpm typecheck`、`pnpm test`（43 files / 319 tests）、ID trace check（ERROR 0 件）。
