---
created_at: 2026-11-14
status: created
type: change
plan: []
requirements: [FR-37, FR-41, FR-78, NFR-7, NFR-8]
requires: human
---

# 045 永続化リファクタリングの実DB data migration・切替・検証

元計画：#038の移行手順。

## Dependencies

- #041
- #042
- #043
- #044

## Scope

- dry-runを既定とし`--apply`時だけ既存recordを更新するdata migration scriptを作成する。Event参照、subject relation、Projection、未完了work itemの変換・整合性検証を行う。
- 実DBでdata migration、reader差分確認、writer切替、通常Event / Reflection / Tool / Outboxの実行確認を行う。
- 実DB上の実Agentを使い、`user-message`、`idle`、`concern-formation`、`concern-due`、`external-change`、`scheduled-task`、`memory-update`、`prediction-g3`、`prediction-g3-result`、`reflection`の全処理経路を少なくとも1回ずつ実行する。実データのEvent、Run、Experience、Memory、Concern、Prediction、配送状態が更新されることを許容し、各経路の成功・意図したno-op・失敗理由を監査recordとDebug UIで照合する。
- 過去Debug UI表示のsnapshot backfillは行わず、新writer切替後のEvent traceだけを対象にする。
- 旧列・旧JSONをdropする前の保持期間、件数、整合性、rollback条件を記録する。
- 最終dropを別Issueへ分離する。

## Out of scope

- 実DBの旧列・旧tableの削除。

## Acceptance criteria

- [ ] FR-37 / FR-41 / FR-78：実DBで通常EventとReflectionの監査・検索・根拠解決が確認できる。
- [ ] NFR-7 / NFR-8：data migration scriptがdry-run / apply、変換件数、参照整合性、未完了work itemを検証し、writer切替後もatomic commitを維持する。
- [ ] 追加：実DBで上記の全Event処理経路を実行し、Eventごとの入力、判断又はmaintenance結果、Tool、出力、State / Memory / Concern更新、配送、後続処理を確認した検証記録がある。
- [ ] 追加：dropの前提となる保持期間とrollback不能境界についてユーザー承認を得る。

## Tests

- NFR-7 / NFR-8：隔離DBでmigration / backfill / rollback rehearsalを行い、実DBではread-only比較後に明示承認を得て切替を行う。
