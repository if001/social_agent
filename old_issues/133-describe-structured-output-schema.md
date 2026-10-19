---
created_at: 2026-10-11
status: done
---
# 133: 構造化出力の説明をZodへ集約

## Background
出力構造とTool呼出手順をsystem promptで重複説明している。ユーザーの指定に従い公式LangChain資料を調査する。

## Scope
- AgentCoreOutputSchemaの日本語describe
- Emotionの制約を生成用スキーマにも反映
- system promptの出力構造・JSON例を削除
- 調査結果をdocsへ記録

## Out of scope
モデル、provider strategyへの切替、DB変更。

## Implementation notes
[修正方針](../docs/STRUCTURED_OUTPUT.md)。Tool呼出はライブラリに任せ、業務判断はpromptに残す。

## Acceptance criteria
- 各フィールドの意味がスキーマから伝わる
- Emotion以外の即時更新や不正な値・操作を拒否する
- 構造化出力と既存の修復処理が回帰テストを通る

## Tests
型検査、lint、unit/contract、system。Live LLMは実行しない。

## Results
型検査・lint成功。unit/contract 122件、system 29件成功。DB migration不要。Live LLM未実施。
