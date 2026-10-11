# Test Strategy

本書は現在の実装に対する検証方針を定める。要求の一次資料は[概念設計](../spec/personal-agent-concept-design-restructured-v2.md)と[実装設計](../spec/personal-agent-implementation-design-v2.md)である。

## Test layers

### Unit / contract

schema、focused context上限、token budget、実行予算、Action変換、schedule計算を外部serviceなしで検証する。境界値と不正な構造化出力を含める。

### System

fake model、fake tool、in-memory adapterで、直接ActionとTool経由Actionの両方を検証する。特に次を固定する。

- model callは最大2回、tool callは最大1回
- `respond`と`refuse`のOutbox保存
- Action確定後のpost-process failure分離
- continuityとmemoryによる共有model result
- Emotionの根拠と6時間expiry
- Motiveと再検討scheduleの同期
- autonomy reviewから通常Decision loopへの接続

### PostgreSQL integration

実repositoryとmigrationを使い、transaction、claim、冪等性、Outbox、Emotion、Motive scheduleを検証する。DB接続値はtest実行時に環境から読み取ってよいが、test outputへ値を表示しない。

### Evaluation

人格らしさや状態に応じた判断は、同じ入力で内部状態だけを変えたpaired scenarioを実モデルで反復する。各runにはscenario ID、state条件、model、時刻、構造化判定、failure kindを記録し、scenario別・失敗種別の集計を生成する。

自動testの合格だけでは振る舞いを「評価済み」にしない。評価済みとするには、必要反復数を満たしたartifactと、事前に定めた閾値を満たす集計が必要である。

## Standard verification

通常の変更は`pnpm verify`でformat、lint、typecheck、unit、system、integrationを実行する。変更範囲に応じてmigration検証と実モデルevaluationを追加する。

## Release conditions

- 対象contractのunit / system testが成功する。
- DB変更がある場合はPostgreSQL integration testが成功する。
- schema、migration、repository、文書の用語が一致する。
- 振る舞いを主張する変更では、反復evaluation artifactと集計を保存する。
- flaky、skip、未分類failureを成功件数に含めない。
