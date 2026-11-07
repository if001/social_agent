---
created_at: 2026-11-07
status: done
type: fix
plan: []
requirements: [C-03, C-16]
ui: []
requires: agent
---

# 018 Experience Integrationの再試行復元と構造化出力修復

元計画：Experience Integrationの初回実装（Issue #017）

## Background

2026-11-07に`experience_integration.failed`が、MemoryIntentの必須field不足で発生した。さらに失敗済みtraceの再試行時、保存したsnapshotでは`toolExecutions`が`result`の外にあるにもかかわらず、復元側が`result`だけを`AgentRunResultSchema`としてparseしていた。そのため、再試行はLLMを呼ぶ前に失敗し続ける。

Experience Integrationは応答commit後の保存判断であり、失敗しても初回Actionを巻き戻さず、監査可能なtraceから再試行できなければならない。

## Dependencies

- #017 Experience Integration after Agent Core（done）

## Scope

- Experience Integration traceの保存・復元形式を`AgentRunResult`と一致させる。
- 既存traceの旧形式（top-level `toolExecutions`）も再試行可能にする。
- providerがMemoryIntent schemaに適合しない出力を返した場合、検証エラーを与えて一度だけ構造修復を試みる。
- Integration promptにMemoryIntentの必須field、値域、空出力を明示する。
- 出力不正と再試行復元を対象に回帰テストを追加する。

## Out of scope

- Agent Coreの出力schema変更。
- MemoryIntentのfield・値域の変更。
- 初回commit transaction内でIntegration traceを作る設計変更。
- Debug UIへの生LLM出力表示。

## Implementation notes

- 既存の`experience_integrations.input`はmigrationせず、read-timeで旧snapshotを正規化する。
- 構造修復は同じ入力に対して最大1回とし、通常のIntegration判断を再実行しない。
- 初回応答・Outboxへのfailure isolationを維持する。

## Acceptance criteria

- [x] C-03：新規Integration traceを再試行しても、保存済みTool executionを含む`AgentRunResult`として復元できる。
- [x] C-03：旧trace形式でもtop-levelの`toolExecutions`を補完して再試行できる。
- [x] C-03：最初のprovider出力がMemoryIntent schemaに不適合でも、検証内容を渡す1回の修復出力が適合すれば適用される。
- [x] C-16：修復後も不適合ならIntegrationをfailedとして記録し、初回Actionは失敗しない。
- [x] C-03：promptがMemoryIntentの必須field・enum・保存不要時の空配列を明記する。

## Tests

- C-03：`PostgresExperienceIntegrationRepository.pending` の新snapshot復元を検証するintegration test。
- C-03：`PostgresExperienceIntegrationRepository.pending` の旧snapshot互換を検証するintegration test。
- C-03：`ExperienceIntegration` の公開`processReserved`境界で、invalid output後にvalid repairが適用されるunit test。
- C-16：`ExperienceIntegration` の公開`processReserved`境界で、repair失敗が`fail`へ隔離されるunit test。

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md C-03/C-16 | 不具合修正であり概念・責務分割は変更しない | 不要 |
| spec/personal-agent-implementation-design-v2.md | trace再試行の実装詳細であり設計上の責務は変更しない | 不要 |

## 実装メモ

- 新形式は`result.toolExecutions`へ保存し、既存のtop-level `toolExecutions`は復元時にだけ補完するためDB migrationは不要。
- 初回出力がZod schemaに不適合な場合だけ、検証issueを渡す修復呼び出しを1回行う。修復失敗は従来どおりtraceをfailedにして初回Actionを巻き戻さない。
- 検証：`pnpm typecheck`、対象ファイルの`npx eslint`、`pnpm test -- --runInBand`（199 tests）、PostgreSQL integration test（28 tests）。全体`pnpm lint`は既存の未変更3ファイルの5件で失敗する。
- 変更整合性：`docs/work/analyze/2026-11-07-change.md`（CRITICAL/HIGH 0件）。レビュー：`docs/work/reviews/2026-11-07-issue-018.md`（HIGH 1件を修正済み）。
