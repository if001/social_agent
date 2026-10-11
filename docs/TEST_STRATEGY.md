# Test Strategy

本書は現在の実装に対する検証方針を定める。要求の一次資料は[概念設計](../spec/personal-agent-concept-design-restructured-v2.md)と[実装設計](../spec/personal-agent-implementation-design-v2.md)である。

## Test layers

### Unit / contract

schema、focused context上限、推定token budget、実model call予算、Action変換、schedule計算を外部serviceなしで検証する。全call種別のgate、境界値、不正な構造化出力を含める。

### System

fake model、fake tool、in-memory adapterで、直接ActionとTool経由Actionの両方を検証する。特に次を固定する。

- assessmentを含む実model call計数、設定されたTool上限、production上限25
- 依存Tool、失敗後の別Tool、同一Tool・同一入力の拒否、失敗Toolだけでのno-action拒否
- 現EventのMeaning/Emotionと、Self/Mood/Social Context/Motiveを含む型付き根拠
- `respond`と`refuse`のOutbox保存
- Action確定後のpost-process failure分離
- 永続的な単一experience-integration job、continuityとmemoryの共有model result、失敗後の再claim
- Emotionの根拠と6時間expiry
- Motiveと再検討scheduleの同期
- autonomy reviewから通常Decision loopへの接続

### PostgreSQL integration

実repositoryとmigrationを使い、transaction、claim、冪等性、Outbox、Emotion、Motive scheduleを検証する。DB接続値はtest実行時に環境から読み取ってよいが、test outputへ値を表示しない。

### Evaluation

人格らしさや状態に応じた判断は、同じ観測で内部状態だけを変えた6組のpaired scenarioを実モデルで反復する。各variantを最低3回実行し、scenario ID、state条件、model、時刻、入力・出力、Tool trace、配送、次state、構造化判定、failure stage/kindを記録する。失敗を分母に含め、行動率差、最小効果量2/3、95% Wilson区間をpair別に集計する。

自動testの合格だけでは振る舞いを「実証済み」にしない。欠測、hard/semantic failure、期待方向の効果量不足はいずれもgate不合格とし、CLI終了値1で検出する。2026-10-11の36試行は全件保存されたが全6 pairが不合格であり、自律性改善の成功証拠には使わない。

## Standard verification

通常の変更は`pnpm verify`でformat、lint、typecheck、unit、system、integrationを実行する。変更範囲に応じてmigration検証と実モデルevaluationを追加する。

## Release conditions

- 対象contractのunit / system testが成功する。
- DB変更がある場合はPostgreSQL integration testが成功する。
- schema、migration、repository、文書の用語が一致する。
- 振る舞いを主張する変更では、反復evaluation artifactと集計を保存する。
- flaky、skip、未分類failureを成功件数に含めない。
