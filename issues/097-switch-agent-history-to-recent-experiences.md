---
created_at: 2026-10-08
status: done
---

# 097: Agent Core履歴とTool反復防止をRecent Experienceへ切り替える

## Background

Issue 096で構成するRecent ExperienceをAgent Coreの唯一のEvent間短期履歴とし、既存の`recentObservations`と`recentAttempts`を削除する。

## Dependencies

- Issue 096

## Scope

- 日本語Agent Core promptへRecent Experienceの目的と構造を記述する
- `recentObservations`と`recentAttempts`をPrompt、Domain契約、fixtureから削除する
- Tool反復防止用の過去入力をRecent ExperienceのTool stepから導出する
- Deep Agentのnative Message stateがrunを越えて保持されないことをcontract testで固定する
- 不要になったRecent Attempt生成Query、Schema、helper、testを削除する

## Out of scope

- Recent Experience projection自体のDB実装
- Tool側の出力size契約変更
- Memoryとの重複制御

## Implementation notes

- PromptへRecent Experienceと同じ内容の別配列を重複投入しない。
- Tool反復防止はRuntime／Middleware用の導出値であり、永続正本を追加しない。
- 後方互換用の旧フィールドは残さない。

## Acceptance criteria

- Agent Core入力に`recentObservations`と`recentAttempts`が存在しない
- Event間の短期履歴が`recentExperiences`だけである
- 同じTool入力の短時間反復防止が維持される
- Deep Agent Message stateが同一run内だけである
- Promptに履歴が重複しない

## Tests

- Agent Core prompt contract test
- Recent ExperienceからTool入力を導出するunit test
- 複数Toolを含むrunと次Eventのsystem test
- 旧フィールドがPromptへ含まれないtest
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:system`

## References

- [Issue 095](./095-review-agent-history-and-recent-attempts.md)
- [Issue 096](./096-implement-recent-experience-projection.md)
- [Architecture §5.5.1](../docs/ARCHITECTURE.md)
