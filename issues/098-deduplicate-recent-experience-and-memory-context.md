---
created_at: 2026-10-08
status: done
---

# 098: Recent ExperienceとMemoryのContext重複を抑制する

## Background

直近EventはRecent Experienceに含まれる一方、そのEventを根拠とするEpisodic Memoryが検索される場合がある。単純な言い換えを両方投入するとContextを圧迫するが、Semantic化や自己解釈を加えたMemoryは同時に利用する価値がある。

## Dependencies

- Issue 096
- Issue 097

## Scope

- Memoryの`evidenceEventIds`とRecent ExperienceのEvent IDによる重複候補を検出する
- 直近Eventの単純な再述であるEpisodic MemoryをContextから除外する決定規則を設計・実装する
- Semantic、self-related、重要度の高い追加解釈を併用できる規則にする
- Memory Retrieval traceへ重複除外理由を追加する
- 重複除外件数を観測可能にする

## Out of scope

- Memory本文をLLMで再判定する追加call
- Memory Retrieval全体のranking刷新
- 保存済みMemoryの削除・統合

## Implementation notes

- 明示的なevidence Event IDとMemory kindを優先し、自由文類似だけへ依存しない。
- 重複判定のために追加LLM callを行わない。
- Recent Experienceのwindow外へ出た後は、Memoryを通常どおり検索対象に戻す。

## Acceptance criteria

- 同じEventの単純なEpisodic Memoryが二重投入されない
- Semanticまたは自己解釈を追加するMemoryは必要に応じて併用できる
- window外のEventを根拠とするMemoryは除外されない
- 除外理由がRetrieval traceとlogで確認できる

## Tests

- 同一EventのEpisodic Memory重複除外test
- Semantic／self-related Memory併用test
- Recent Experience window外のMemory保持test
- rankingとContext budget回帰test
- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test:integration`

## References

- [Issue 095](./095-review-agent-history-and-recent-attempts.md)
- [Issue 096](./096-implement-recent-experience-projection.md)
- [Issue 097](./097-switch-agent-history-to-recent-experiences.md)
- [Architecture §5.5.1](../docs/ARCHITECTURE.md)
