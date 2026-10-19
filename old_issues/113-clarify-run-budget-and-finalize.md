---
created_at: 2026-10-11
status: done
---

# 113: Run内の読取予算を明確化しTool上限後に最終出力する

## Background

Agentがcontent-read予算を時間経過で回復する制約だと誤解し、次回実行を予約した。予約Runでも予算とTool回数の上限後にToolを呼び、最終構造化出力を返さず失敗した。

## Scope

- content-read予算は現在のrun中は固定であり、次のrun開始時にだけリセットされるとAgentへ伝える。
- 予算超過とTool回数超過を機械判別できるTool結果として返す。
- 上限到達後は既取得情報で最終Actionを返し、予算回復だけを目的に待機・予約しないよう指示する。
- 回帰テストと関連ドキュメントを更新する。

## Acceptance criteria

- [x] Agentが読取予算を時間経過で回復すると解釈しない。
- [x] Tool上限到達がAgent Core全体の例外を直接発生させない。
- [x] 上限到達後に最終構造化出力へ進む指示とテストがある。
