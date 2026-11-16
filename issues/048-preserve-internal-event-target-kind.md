---
created_at: 2026-11-16
status: done
type: fix
plan: []
requirements: [NFR-12]
ui: []
requires: agent
---

# 048 大きな内部EventでもtargetKindを監査用に保存する

元計画：G3結果Eventの種別がDebug UIで`internal`単体になる不具合

## Background

ContextBuilderは4,000文字を超える`observation.content`を丸ごと除外する。そのため、G3結果のように大きなpayloadでは、Runtimeの分岐に必要な`targetKind`まで保存断面から失われ、後からEvent種別を観測できない。

## Dependencies

- なし

## Scope

- 大きな`observation.content`をAgent Core入力から除外する既存の予算制御を維持する。
- 内部Eventの`targetKind`を、内容のサイズに関係なく軽量な保存・判断入力断面として残す。
- Debug UIが既存の`internal / targetKind`表示を継続できることをテストする。

## Out of scope

- G3 output・tool evidence全体をEvent observationへ保存すること
- 過去Eventのbackfill
- Event kind列にG3専用の値を増やすこと

## Implementation notes

- `targetKind`は`content`の一部としてではなく、Observationの軽量なscheduler分類として保持する。
- 既存のRecent Experience投影とDebug UIの読取りを壊さない。

## Acceptance criteria

- [x] AC-048-1：4,000文字を超える内部Event payloadでも、Agent Core入力・保存Event observationから`targetKind`を確認できる。
- [x] AC-048-2：大きなpayload本文は従来どおり入力断面へ複製されない。
- [x] AC-048-3：Debug UIは保存された内部Eventを`internal / prediction-g3-result`として表示できる。

## Tests

- NFR-12：大きなG3結果相当の内部Eventで、targetKindだけが保持されることを検証する。
- NFR-12：Debug UI queryが保持済み分類を読取り専用で表示する契約を検証する。

## 実装メモ

- ContextBuilderは4,000文字超の`observation.content`を本文ごと保存せず、`kind: internal`かつ文字列の`targetKind`を持つ場合だけ`{ targetKind }`へ縮約する。
- Runtime persistenceはContextBuilder後の`input.observation`を保存するため、新規EventではDebug UIの既存queryがそのまま内部種別を読める。
- `tests/unit/memory-context.test.ts`に巨大なG3相当payloadの回帰テストを追加した。`pnpm test`（241件）、`pnpm typecheck`、`pnpm lint`、`trace_check.py --root .`は成功した。
