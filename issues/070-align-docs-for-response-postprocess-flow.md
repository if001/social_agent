---
created_at: 2026-10-05
status: created
---

# 070: 応答・Post-process分離に合わせてdocsを整合する

## Background

Issue 069で、応答とEmotion / DesireをInteraction処理で確定し、Memory、Intention、Long-term Candidate、Mood、Drive、Working Social Contextを応答後のPost-processで扱う境界を設計する。実装前に、`spec/`を一次情報として`docs/`のAgent Core契約、Runtime transaction、Outbox、State Update、Memory、Intention、Long-term Review、Event順序を整合させる必要がある。

## Scope

- Issue 069の設計を前提に`docs/`全体を調査する
- 応答・Emotion / DesireとPost-processの責務、入力、出力、失敗時の扱いをdocsへ反映する
- Agent Coreの出力契約とPost-process用契約を区別して記載する
- Outbox配送、Post-process起動、永続化、同一AgentのEvent順序を図と本文で明確化する
- Memory、Intention、持続状態、Long-term Candidate、Long-term Reviewの境界を整合させる
- docs修正後にIssue 071のScope、実装メモ、受入条件、テストを再確認し必要なら更新する

## Out of scope

- アプリケーションコード、DB migration、テストコードの変更
- Discord途中応答・typing表示の実装
- specの概念設計を変更すること

## Implementation notes

- `spec/`とIssue 069の設計を優先し、docsから別の状態分類や二重のTool loopを導入しない。
- Deep Agent内のTool loop、Interaction処理、Post-process、Long-term Reviewを別責務として明記する。
- Post-processの非同期化を、持続状態の更新を無秩序に並列実行する意味にしない。Agentごとの順序・再試行方針を記載する。
- 更新候補は少なくとも`docs/ARCHITECTURE.md`、`docs/REQUIREMENTS.md`、`docs/IMPLEMENTATION_PLAN.md`、`docs/TEST_STRATEGY.md`、`docs/MANUAL_SMOKE.md`とする。

## Acceptance criteria

- docsのAgent Core出力、Runtime、Outbox、Post-process、Long-term Reviewの説明が相互に一致する
- Emotion / Desireが応答と同じ処理で確定し、持続状態・経験整理が応答後に行われることが明記されている
- Post-processの失敗と再試行が応答配送を妨げないこと、後続Eventとの順序制御が必要なことが記載されている
- MemoryとWeb Tool結果の保存責務が既存Web Archive設計と矛盾しない
- docs更新後のIssue 071がdocsと矛盾しない

## Tests

- `rg`で旧来の「単一Agent Coreが応答と全提案を同時に確定する」記述を調査・更新する
- Mermaid、型例、処理順序図と本文の整合をレビューする
- Issue 069の状態分類表とdocsの状態分類が一致することを確認する

## Dependencies

- Issue 069

## Plan reference

- [Issue 069: 応答・即時状態と応答後Post-processの境界を設計する](./069-design-response-and-postprocess-boundary.md)
- [Implementation design: Short-term Update と Long-term Update](../spec/personal-agent-implementation-design-v2.md#21-short-term-update-と-long-term-update)
- [Implementation design: Internal Event](../spec/personal-agent-implementation-design-v2.md#24-internal-event)

