---
created_at: 2026-10-07
status: done
---

# 086: state-reviewを通常Coreから分離してContinuityへ直接接続する

## Background

現在の`state-review`はSchedulerがInternal Eventとして生成し、通常Deep Agentで応答・Tool利用を判断した後、さらにContinuityとMemoryのpost-processを起動する。このため、持続状態の再評価が通常CoreとContinuityで重複し、状態確認だけのrunからWeb探索が始まってdeadlineを消費する事例が発生した。

`autonomy-review`は主体的行動を判断するEventとして通常Coreへ渡す。一方、`state-review`は時間経過によるMood、Drive、Current Interest、Intentionの再評価に限定し、通常Core、外部Action、Tool、Memory抽出を経由せずContinuity Reviewへ直接接続する。

## Scope

- `state-review`と`autonomy-review`の責務をRequirements、Architecture、Test Strategyへ明記する
- `state-review` Event/runの監査記録を維持したまま通常Deep Agentを呼ばない経路を実装する
- `state-review`では決定的な`no-action`を記録し、Continuity jobだけを作成・実行する
- `state-review`からTool実行、外部応答、Memory Extraction、Long-term Candidate生成が起きないようにする
- `autonomy-review`は通常Deep AgentとTool loopを利用する既存経路を維持する
- 失敗時のSchedule release/retryと観測ログを維持する

## Out of scope

- `autonomy-review`の探索方針変更
- Continuityの出力スキーマ変更
- State値の固定的な時間減衰
- Long-term Reviewの経路変更
- DB schema変更

## Implementation notes

- `state-review`も因果追跡のためEventとAgent Runを保存する。
- Agent Runtimeで`targetKind=state-review`を判定し、通常Harnessの代わりに空の即時更新と`no-action`を持つRuntime生成結果をcommitする。
- Persistenceは`state-review`のcommit時にContinuity jobのみを作る。通常InteractionはContinuityとMemoryを並列生成する。
- 永続状態の意味判断はContinuity LLMに任せ、Runtimeは更新内容を生成しない。

## Acceptance criteria

- `state-review`で通常Deep Agentが呼ばれない
- `state-review`でToolと外部応答が発生しない
- `state-review`のEvent/runが保存され、Continuity jobだけが生成される
- ContinuityがMood、Drive、Current Interest、Intentionの変更または変更なしを判断できる
- `autonomy-review`は通常Deep AgentでToolまたはActionを判断できる
- docsと実装の説明が一致する

## Tests

- `state-review`がHarnessを呼ばず`no-action`を返すsystem test
- `state-review`がContinuity jobだけを生成するintegration test
- `autonomy-review`が通常Harnessへ渡る回帰test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`
- `pnpm test:system`

## References

- [Concept implementation design](../spec/personal-agent-implementation-design-v2.md)
- [Requirements](../docs/REQUIREMENTS.md)
- [Architecture](../docs/ARCHITECTURE.md)
- [Test Strategy](../docs/TEST_STRATEGY.md)
- [Issue 071](./071-implement-immediate-response-and-post-process-separation.md)
- [Issue 073](./073-stabilize-post-process-prompts-and-harnesses.md)
