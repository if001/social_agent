---
created_at: 2026-11-20
status: done
type: change
plan: []
requirements: [NFR-10]
ui: []
requires: agent
---

# 060 Runtimeの因果hop上限を環境変数で設定する

起点：allowlist peer Bot間通信の設計

## Background

Runtimeのhop上限はBot間の因果循環だけでなく、全配送経路で無限連鎖を機械的に停止するNFR-10の制約である。現在はBot composition内の固定値`4`であり、運用時に調整できない。

## Dependencies

- 055

## Scope

- `RUNTIME_MAX_HOPS`を設定として追加し、正の整数かつdomain schema上限32以下を検証する。
- 未設定時の既定値を5にする。
- Bot compositionが設定値をRuntime limitsへ渡す。
- `.env.sample`に目的と既定値を記載する。

## Out of scope

- Event種別ごとに異なるhop上限
- peer配送そのもの（056）

## Acceptance criteria

- [x] AC-060-1：未設定時、Runtimeのhop上限は5である。
- [x] AC-060-2：`RUNTIME_MAX_HOPS`で1〜32の値を設定でき、不正値は起動時に拒否する。
- [x] AC-060-3：設定値がBot compositionからRuntimeへ渡る。

## 実装メモ

- `RUNTIME_MAX_HOPS`はRuntime共通の因果配送上限であり、peer通信専用の設定にはしない。
- `tests/unit/config-lifecycle.test.ts`で既定値、override、不正値、compositionへの伝播を検証した。
- レビュー記録：`docs/work/reviews/2026-11-20-issue-060.md`

## Tests

- NFR-10：設定の既定値・override・不正値と、compositionのRuntime limitをunit testする。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | NFR-10 | Runtime hop上限を運用設定可能にする | `.env.sample` |

## 影響範囲

| 場所 | 内容 | 対応 |
|---|---|---|
| `src/config/config.ts` | 環境変数parseとAppConfig | 更新する |
| `src/bootstrap/bot-composition.ts` | Runtime limits | 更新する |
| `.env.sample` | 設定例 | 更新する |
| `tests/unit/config-lifecycle.test.ts` | 設定検証 | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| `spec/` | NFR-10の範囲内。変更不要 | 不要 |
| `docs/REQUIREMENTS.md` | NFR-10の既存要求で表現済み | 不要 |
| `docs/ARCHITECTURE.md` | Runtimeのhop検査は既に記載済み | 不要 |
