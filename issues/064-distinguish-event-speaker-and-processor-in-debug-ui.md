---
created_at: 2026-11-21
status: created
type: fix
plan: []
requirements: [NFR-12]
ui: []
requires: agent
---

# 064 Debug UIでEventの発話者と処理担当を区別する

## Background

peerの通常投稿は、受信側Agentが所有する観測Eventになる。Debug UIが所有Agentだけを示すと、Discord上の発話者と取り違えられる。

## Dependencies

- 063

## Scope

- Event一覧と詳細に、メッセージ発話者とEvent処理担当を別に表示する。
- peer subjectの自然言語名を優先し、未解決時だけ監査actorの表示へ退避する。

## Out of scope

- Event所有権、Discord配送、canonical subjectの変更

## Acceptance criteria

- [ ] AC-064-1：peer受信Eventで発話者と処理担当を別に表示する。
- [ ] AC-064-2：非メッセージEventで発話者がないことを誤認させない。
- [ ] AC-064-3：Event一覧queryは選択Agentの所有権filterを維持する。

## Tests

- NFR-12：Event一覧が処理担当Agent IDを取得し、表示用helperを含むことをUnit testで確認する。
