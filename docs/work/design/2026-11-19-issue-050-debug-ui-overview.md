# Debug UIセルフチェック：Issue 050（2026-11-19）

## 対象

- `src/debug-ui/page.ts` のAgent Overview

## 確認結果

| 観点 | 結果 |
|---|---|
| 主要情報 | Self本文、現在のmood、active Concern、Concern Activity、予約タスクを別パネルにした。 |
| 用語 | `Self`、`Concern`、`Scheduled Task` は既存画面と同じ表記にした。 |
| 件数の意味 | 予約タスクは全取得件数、状態別件数、実行日時順の直近8件を別キーで表示する。 |
| 正本 | Concern descriptionはActivityへ複製せず、現在のAgent Stateから表示時に対応づける。 |
| 操作安全性 | 既存の読取り専用APIだけを利用し、書込み導線を追加していない。 |
