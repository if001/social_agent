---
created_at: 2026-10-11
status: done
---

# 117: Deep Agentの実経路で最終化とエラー追跡を修正する

## Background
Issue 116は供給されないremainingStepsと、構造化出力検証後の応答書換えに依存していた。Provider例外の内側も保存されていなかった。

## Scope
- 探索Model Callを最大3回、その後の最終出力・修復を最大2回に制限する。
- 通常Toolをすべて除外して最終化する。構造化出力はライブラリの修復処理を利用する。
- 原因チェーンと構造化出力エラー、返却Tool名を記録する。
- 実Deep Agent graphにfake modelを接続する回帰テストを追加する。

## Out of scope
- 過去に失われた例外の復元、Prompt履歴短縮、deadline内の成功保証。

## Implementation notes
- remainingSteps依存と複数回答の先頭選択を削除する。
- Graph hard limitは最低64へ分離し、Model Call上限と既存deadlineで実行を制限する。
- failure_reasonは既存text列へredaction済みエラー詳細をJSON保存する。migration不要。
- 既存maxStepsが小さい場合、探索回数はmax(1,min(3,floor(maxSteps/4)))とする。

## Acceptance criteria
- [x] 実graphで3回探索後に通常Toolがなくなり、構造化出力が生成される。
- [x] 複数構造化出力を勝手に選ばず、ライブラリで修復できる。
- [x] 原因チェーン内の資格情報を除去して記録できる。

## Tests
- 実Deep Agent + FakeToolCallingModelによるTool実行、複数出力、修復完了。
- 原因チェーンのredaction、unit/contract、system、typecheck、lint。

## References
- [Issue 116](116-guarantee-deep-agent-finalization.md)
- [Architecture](../docs/ARCHITECTURE.md)

## Validation
- unit/contract 109件、system全体24件成功。その後追加した持続的なSchema不適合を含むtool-loop 11件成功（system計25件相当）。
- typecheck、lint、diff check成功。実Ollama評価は未実施。
