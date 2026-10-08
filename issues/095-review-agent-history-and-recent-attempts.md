---
created_at: 2026-10-07
status: created
---

# 095: Agent Message履歴とrecentAttemptsの責務を再検討する

## Background

一般的なAgentの文脈履歴は`[user, agent, tool, tool, agent, user]`のように、会話、Tool Call、Tool Resultを時系列で保持する。現在の実装ではこのMessage履歴は1回のAgent Core run内だけに存在し、次のEventでは新しい`agent.invoke()`を開始する。Event間の文脈は`recentObservations`、`recentAttempts`、Memory、Social Context、Active Intentionから再構成する。

`recentAttempts`はAgent Run、Action、Tool Execution、State Changeから「何を試し、どうなったか」を投影するため、Message履歴をEvent間で保持する設計へ変更した場合は目的と内容が重複する可能性がある。現在方式を維持する場合でも、Recent Observation、Episodic Memoryとの境界を明確にする必要がある。

## Scope

- `spec/`を一次情報としてEvent、Observation、Memory、Intention、Agent Core Inputの履歴要件を確認する
- 現在のDeep Agent Message履歴がrun内だけで、Event間に引き継がれないことをコードと実データで確認する
- `recentObservations`、`recentAttempts`、同一run Message履歴、Episodic Memoryの生成元、時間範囲、用途、重複を整理する
- Event間Message履歴を保持する方式と、構造化projectionから再構成する現在方式を比較する
- Discord上の連続会話、途中のInternal Event、自律行動、複数Tool Callを含む具体例で必要な認識を検証する
- `recentAttempts`を維持、縮小、名称変更、Message履歴から導出、または廃止する選択肢を比較する
- 採用方針、移行範囲、追加Issueの必要性を`docs/`へ記録する

## Out of scope

- 採用方針のコード実装
- Social Context／Active Intentionの選択修正
- Event、Agent Run、Tool Executionの監査記録削除
- 全履歴の無制限なPrompt投入

## Implementation notes

- Internal EventはAgent自身の経験順序を表すため一律除外しない。
- 「ユーザーとの会話→自律行動→ユーザーとの会話」は、Agentにとって途中の自律行動を含む連続した経験として扱う。
- Message履歴を採用する場合も、永続正本、Prompt用projection、監査記録を区別する。
- Tool ResultはIssue 091／092の有界化と圧縮を維持する。
- `recentAttempts`を残す場合は、同一runのTool Loop再現ではなく、runをまたぐ失敗反復防止など固有の責務を明示する。

## Acceptance criteria

- 現在のMessage履歴の保持範囲がコード根拠付きで説明されている
- 4種類の履歴入力の責務と重複が表またはフローで整理されている
- Event間Message履歴を保持するかどうかが決まっている
- Internal Eventと自律行動を含む経験順序の扱いが決まっている
- `recentAttempts`の維持、変更、廃止のいずれかと理由が決まっている
- Context上限、履歴圧縮、Memory昇格の境界が決まっている
- 採用方針が`docs/`へ反映され、必要な実装Issueが特定されている

## Tests

- ユーザー会話の間にInternal Eventがあるシナリオ整理
- 複数Tool Callを含む単一runと次Eventの境界確認
- Recent ObservationとRecent Attemptの重複例確認
- Episodic Memoryへ昇格した後の重複確認
- Prompt context量の比較

## References

- [Concept Design](../spec/personal-agent-concept-design-restructured-v2.md)
- [Implementation Design §9 Observation](../spec/personal-agent-implementation-design-v2.md#9-observation)
- [Implementation Design §17 Memory Retrieval](../spec/personal-agent-implementation-design-v2.md#17-memory-retrieval)
- [Issue 090](./090-bound-agent-context-and-exclude-raw-tool-results.md)
- [Issue 091](./091-bound-in-run-web-archive-results.md)
- [Issue 092](./092-compact-deep-agent-tool-history.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Requirements](../docs/REQUIREMENTS.md)
