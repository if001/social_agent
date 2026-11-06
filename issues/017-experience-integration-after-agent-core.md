---
created_at: 2026-11-07
status: doing
type: change
plan: []
requirements: [追加]
requires: agent
---

# 017 Agent Core後のExperience Integrationで永続状態を判断する

元計画：ユーザーとの2026-11-07の合意（AgentCoreの最終schemaを縮小し、Memory・Relationship・Moodの持続的な更新判断を後段へ分離する）

## Background

Agent Coreの`remember`へMemory本文、視点、用途を追加すると、通常応答の構造化出力が複雑になり、schema検証失敗の面積を広げる。現在のRuntime commitは候補を検証・永続化するだけで、MemoryやRelationshipの意味判断はAgent Coreのstate patchに依存している。

Agent Coreは今回のMeaning / Feeling / Desire / Actionを確定し、応答commit後のExperience Integrationが、Event、Action、Tool結果、Assessment、既存StateからMemory、Relationship、Moodの持続的更新を判断する。保存は既存のMemoryWriteServiceとtransaction境界を維持する。Integration失敗は応答済みRunを失敗にしない。

## Dependencies

- なし

## Scope

- Agent Core最終schemaからMemory、Relationship、Moodのstate patchを取り除く
- 応答commit後に動くExperience Integrationの入力、専用schema、失敗隔離、監査記録を追加する
- IntegrationのMemoryIntentへperspective / purposeを設定し、話者subjectとの対応を保存層で適用する
- Integrationが提案したRelationship、Mood、Memoryを楽観ロックとMemoryWriteServiceを通じて永続化する
- `docs/AGENT_MOTIVATION_MODEL.md`、予測誤差設計、実装設計を新しい責務境界へ更新する
- debug UIでIntegrationの入力、判断、適用結果、失敗を追跡できるようにする

## Out of scope

- Self、Concern、Reflectionの責務変更
- Toolを増やしてMemoryを直接書き込ませること
- Integrationの結果をユーザー応答の前提にすること

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| ADDED | 追加 | AgentCore後のExperience IntegrationがMemory、Relationship、Moodの持続的更新を判断し、応答commit後に適用する | spec/personal-agent-concept-design-restructured-v2.md、docs/AGENT_MOTIVATION_MODEL.md |
| MODIFIED | C-16 | 小さなAgent Loopを維持しつつ、Experience Integrationを保存判断専用の後続処理として位置づける | spec/personal-agent-concept-design-restructured-v2.md |
| MODIFIED | C-03 | 経験からMemory、Relationship、Moodへ反映する経路をExperience IntegrationとReflectionへ明確化する | spec/personal-agent-concept-design-restructured-v2.md |

## 影響範囲

検索した語：`remember`、`State Patch`、`MemoryUpdate Event`、`Relationship`、`Mood`、`commit`、`Reflection`

| 場所 | 内容 | 対応 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md §3, §16, §25 | 経験の長期反映、Agent Loop、Reflectionの責務 | 更新する |
| spec/prediction-error-design.md §5, §6, §7 | MainAgent rememberとMemoryUpdate Eventの経路 | 更新する |
| docs/AGENT_MOTIVATION_MODEL.md | 状態遷移図、State Patch、MemoryUpdate Event | 更新する |
| src/domain/contracts.ts | AgentCore output / MemoryIntent schema | 更新する |
| src/application/agent-runtime.ts | AgentCore後の非同期処理起動 | 更新する |
| src/application/agent-state-patch.ts | AgentCore patch適用 | 更新する |
| src/infrastructure/persistence/postgres-runtime-persistence.ts | 初回commitとIntegration結果の保存境界 | 更新する |
| src/infrastructure/agent/deep-agent-harness.ts | AgentCore structured output schema | 更新する |
| src/debug-ui/ | Integration traceの可視化 | 更新する |
| tests/ | AgentCore schema縮小、Integration失敗隔離、永続化・UI trace | 更新する |

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| spec/personal-agent-concept-design-restructured-v2.md C-03, C-16 | Experience Integrationの責務とReflectionとの差分 | 反映する |
| spec/prediction-error-design.md | MemoryIntentの起点と非同期適用経路 | 反映する |
| docs/AGENT_MOTIVATION_MODEL.md | 状態遷移と用語 | 反映する |

## Implementation notes

- IntegrationはAgentCoreと同じ初期Contextに加え、確定したAssessment / Desire / ActionとTool traceを入力にする。
- AgentCore応答は初回transactionでcommitし、Integrationは後続Eventまたはjobとして実行する。Integrationのschema・provider・保存失敗は初回Runを失敗にしない。
- IntegrationはMemory、Relationship、Moodだけを扱う。SelfはReflection、ConcernはEvent固有のconcern_proposeを維持する。
- Memoryはperspective / purposeを保持し、`user/user-context`だけが話者subjectを持つ。

## Acceptance criteria

- [x] AgentCoreの通常出力schemaにMemory、Relationship、Moodの永続変更フィールドがない。— AgentCore contract test
- [x] 応答のcommit後、IntegrationがEvent、AgentCoreの確定結果、Tool traceを基にMemory、Relationship、Moodの変更候補を判断する。— `ExperienceIntegration` と専用model
- [x] Integrationの失敗が、AgentCoreの応答・outbox・初回Runのcommitを失敗扱いにしない。— `AC-017-3` runtime test
- [x] Memoryはperspective / purposeとsubjectを矛盾なく保存し、MemoryWriteServiceがcreate/update/no-opを決める。— `memorySubjectsForIntegration` と `MemoryWriteService`
- [x] RelationshipとMoodはIntegration結果に限り、楽観ロック付きで更新される。— `PostgresExperienceIntegrationRepository`
- [x] debug UIでIntegrationの入力、出力、適用結果または失敗を確認できる。— Event trace の Core後の処理
- [x] 差分が正の文書に反映されている。— concept / prediction / implementation design / motivation model
- [x] 上流への反映がすべて反映済みまたは不要になっている。
- [x] `spec-analyze change` でCRITICALとHIGHの指摘がない。— `docs/work/analyze/2026-11-07-change.md`

## Tests

- 追加：AgentCore schemaがMemory / Relationship / Moodを要求しないことを契約テストで検証する。
- 追加：Integrationがuser / selfのMemoryを正しいsubjectとpurposeで保存することを統合テストで検証する。
- 追加：Integrationのschema失敗・provider失敗でも応答と初回commitが残ることをsystem testで検証する。
- 追加：Integration traceをdebug UI APIと画面で検証する。

## 実装メモ

- 初回transactionはAction、Concern Proposal、Outboxだけを確定し、Experience Integrationはその後に入力断面を`pending`として記録してから実行する。Integrationの失敗はtraceへ残し、BotHostの定期drainで`pending`/`failed`を再実行する。初回応答を巻き戻さない。
- AgentCoreのschemaはMeaning / Feeling / Desire / Actionへ縮小した。Experience IntegrationだけがMemory、Mood、Relationshipを扱い、SelfとConcernは対象外にした。
- 検証: `pnpm typecheck`、`pnpm lint`、`pnpm test -- --runInBand`（196 tests）、PostgreSQL integration（32 tests）。
- レビュー: `docs/work/reviews/2026-11-07-issue-017.md`。
