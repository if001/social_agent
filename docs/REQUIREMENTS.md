# Requirements

本書は現在の実装要求をまとめた二次資料である。要求の一次資料は[概念設計](../spec/personal-agent-concept-design-restructured-v2.md)と[実装設計](../spec/personal-agent-implementation-design-v2.md)である。

## Agent loop

- 現在EventのMeaningとEmotionをassessment callで決定し、その出力をDecisionへ渡す。
- Decisionとcontinuationは、最終Actionまたは登録済みToolを選ぶ。productionでは最大25 Tool、既定でassessmentを含む最大27 model callとする。
- assessment、Decision、continuation、repairの実model callをすべて実行予算へ数える。
- 同一Tool・同一入力の反復、26回目のTool、予算を超えるcallを拒否する。testでは設定値により小さい上限を使用できる。
- production loopは再帰的委譲、組み込みファイル操作、履歴の自動要約に依存しない。

## Context

- Motiveは最大3件、Social Contextは最大1件、Memoryは3〜5件、Recent Eventは2〜4件を選ぶ。
- `motive-review`の対象MotiveはMotive枠へ必ず含める。
- Selfは判断に必要な内容へ圧縮する。
- active Motiveの根拠はEvent、Memory、Self、Mood、Social Context、Motiveの型付き参照とする。
- system prompt、messages、tools、output schemaを含む総入力を文字数ベースの推定6,000 token以内にする。この値をprovider tokenizerのhard limitとは表現しない。
- 全model callの直前に同じ入力gateを適用する。
- 超過を解消できない場合は黙って切り詰めず、limit errorを返す。

## Action

- `respond`は利用者向け`content`を持つ。
- `refuse`は利用者向け`content`と内部用`reason`を持つ。
- 送信対象ActionはOutboxへ保存し、配送を再試行可能にする。
- ActionとOutboxを同一transactionで確定する。
- Action確定後の状態更新失敗は、確定済みActionを取り消さない。

## Experience integration

- continuity更新とepisodic memory抽出は、永続的な単一`experience-integration` jobと1回の構造化LLM出力を共有し、同一transactionで反映する。
- integration失敗を再試行でき、process再起動でjobを失わない。
- Eventからlong-term memory候補を直接作らない。
- Emotionはdescription、発生時刻、根拠Eventを持つ現在状態として保存する。
- 強いfocusは6時間で失効する。
- Motiveは`nextConsiderAt`と`considerationReason`を持つ。
- Motiveの作成・更新と再検討scheduleを同期する。

## Schedule

- 期限を迎えたMotiveは`motive-review` Eventへ変換する。
- 自律的な再検討は共通のautonomy review経路からDecision loopへ入れる。
- ユーザーが明示したreminder等のScheduled Taskは独立した配送契約として扱う。

## 永続化と運用

- PostgreSQLを永続状態の正本とする。
- Queue受信とOutbox配送は重複実行に耐える。
- 秘密情報はrepositoryへ保存しない。
- `.env`は実行時の設定読込にだけ使用し、文書生成や調査で内容を表示しない。公開可能な設定例は`.env.sample`で管理する。

## 完了と評価

機能の「実装済み」はcode reviewと自動testの合格を意味する。「実行可能」は必要なruntime・test入口が存在すること、「実測済み」は指定条件のlive artifactが保存されたこと、「振る舞いを実証済み」はそのartifactが事前基準を満たしたことを意味する。2026-10-11の36試行は実測済みだがgate不合格であり、状態差による自律性改善は未実証である。
