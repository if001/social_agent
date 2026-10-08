---
created_at: 2026-10-08
status: doing
---

# 102: Tool ResultのContext公開Policyを共通化する

## Background

本文を返すToolごとに、1回・1 Runの取得量、同一Runの過去Tool Message、次Eventの`recentExperiences`、Post-processへの投影を個別実装すると、新しいTool追加時にContext肥大対策が漏れる。`web_archive_read`系とFile Toolは公開契約を分けたまま、結果の公開方針を共通化する必要がある。

## Dependencies

- Issue 101

## Scope

- Tool登録時にResultの分類とContext公開Policyを宣言する
- 即時Model Call、同一Runの過去履歴、`recentExperiences`、Post-process、監査保存の投影を共通処理に集約する
- `web_archive_read`、`web_archive_grep`、`file_read`、`file_grep`へ本文取得Policyを適用する
- 本文取得Tool共通の1 Run文字数予算を適用する
- File Toolの既定・最大取得量を小さくする
- docsを更新する

## Out of scope

- Web ArchiveとFile Toolの公開Tool統合
- Tool実行記録の削除
- DB Schema変更

## Implementation notes

- Tool直後のModel Callには有界な本文を渡す。
- それ以前のTool Message、次Event、Post-processには本文を再投入せず、参照先、範囲、件数、文字数、切断状態などのメタデータを渡す。
- DBのTool実行記録は監査用正本として維持する。
- 未分類Toolは有界な汎用要約を使用し、本文取得Toolは明示Policyなしに登録できない構造にする。

## Acceptance criteria

- Web ArchiveとFile Toolの公開名・アクセス境界が分離されたままである
- 読み取りToolの本文が過去Tool Message、`recentExperiences`、Post-processへ再投入されない
- 本文取得量がTool単位とRun単位の両方で制限される
- Context向け投影ロジックが一つの共通実装を使用する
- 監査用Tool実行結果から必要な参照情報を追跡できる

## Tests

- destination別Tool Result投影test
- 同一RunのTool履歴圧縮test
- `recentExperiences`とPost-processから本文が除外されるtest
- File/Web ArchiveをまたぐRun本文予算test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:system`

## References

- [Architecture: Tool Registry](../docs/ARCHITECTURE.md)
- [Requirements: Tool](../docs/REQUIREMENTS.md)
- [Web Tool](../docs/web_tool.md)
