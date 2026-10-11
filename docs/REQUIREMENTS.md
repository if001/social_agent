# Requirements

本書は現在の実装要求をまとめた二次資料である。要求の一次資料は[概念設計](../spec/personal-agent-concept-design-restructured-v2.md)と[実装設計](../spec/personal-agent-implementation-design-v2.md)である。

## Agent loop

- 1入力につきDecision model callは1回とする。
- Toolが必要な場合だけ、登録済みToolを1回実行し、continuation model callを1回行う。
- 再帰上限と修復回数を実行予算として厳密に守る。
- production loopは再帰的委譲、組み込みファイル操作、履歴の自動要約に依存しない。

## Context

- Motiveは最大3件、Social Contextは最大1件、Memoryは3〜5件、Recent Eventは2〜4件を選ぶ。
- Selfは判断に必要な内容へ圧縮する。
- system prompt、messages、tools、output schemaを含む総入力を6,000 token以内にする。
- 超過を解消できない場合は黙って切り詰めず、limit errorを返す。

## Action

- `respond`は利用者向け`content`を持つ。
- `refuse`は利用者向け`content`と内部用`reason`を持つ。
- 送信対象ActionはOutboxへ保存し、配送を再試行可能にする。
- ActionとOutboxを同一transactionで確定する。
- Action確定後の状態更新失敗は、確定済みActionを取り消さない。

## Experience integration

- continuity更新とepisodic memory抽出は、1回の構造化LLM出力を共有する。
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

機能の「実装済み」はcode reviewと自動testの合格を意味する。「振る舞いを評価済み」は、実モデルを使った反復scenarioの結果とartifactが保存され、判定基準を満たした状態を意味する。両者を同一視しない。
