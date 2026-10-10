---
created_at: 2026-10-11
status: done
---

# 115: Tool上限後は最終構造化出力だけを許可する

## Background

Tool上限を失敗結果として返しても、modelには次のModel Callで同じTool一覧が渡される。Agentが上限後もToolを選べるため、最終構造化出力へ収束せずProvider失敗になる場合がある。

## Scope

- Tool回数上限後は、次のModel Callから通常Toolを除外する。
- content read上限後は、次のModel Callからcontent-read Toolを除外する。
- 構造化出力専用Toolは残し、最終Actionを生成可能にする。

## Acceptance criteria

- [x] Tool回数上限後に通常Toolを再選択できない。
- [x] 読取上限後にcontent-read Toolを再選択できない。
- [x] 最終構造化出力専用Toolは利用できる。
