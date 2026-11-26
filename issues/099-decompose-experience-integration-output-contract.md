---
created_at: 2026-11-26
status: done
type: change
plan: []
requirements: [FR-37, FR-82, FR-95, NFR-8, NFR-21, NFR-23]
ui: []
requires: agent
---

# 099 Experience Integrationの入力と構造出力を責務別に分割する

## Background

本番`shiro`のExperience Integrationで、`memory`、`relationships`、
`relationshipUpdates`、旧`target`、`occurredAt`などの出力が繰り返しschemaを
逸脱した。同じ保存済み`shiro` Runと`.env.shiro`の実LLM設定で再実行すると、
`memories[].target / perspective`のenum逸脱、必須`memories`の欠落、成功が混在した。

現行入力は全Current Self、全State、全Relationship、文脈取得を含むTool結果を
一つの出力schemaへ渡す。`memories`は必須なのにpromptが「省略」と「空配列」を
併記している。Event Experience、Memory、Relationship、Mood、Focus Concernも
一回の出力で扱う。

## 差分

| 種別 | ID | 内容 | 文書 |
|---|---|---|---|
| MODIFIED | FR-37 | Integrationへ渡すTool結果を共通投影の証拠だけに限定する | docs/REQUIREMENTS.md |
| MODIFIED | FR-82 | Experience Integrationを責務別の小入力・小出力で実行できるようにする | docs/REQUIREMENTS.md |
| MODIFIED | FR-95 | Focus Concernの即時判断を独立した小さな出力契約へ分離する | docs/REQUIREMENTS.md |
| MODIFIED | NFR-8 | 後続commitの部分失敗を対象別に扱い、Actionを巻き戻さない | docs/REQUIREMENTS.md |

## 影響範囲

検索した語：`ExperienceIntegrationOutputSchema`、`experienceIntegrationModelInput`、
`Experience Integration`、`toolExecutions`、`FR-37`、`FR-82`、`FR-95`、`NFR-8`。

| 場所 | 内容 | 対応 |
|---|---|---|
| docs/REQUIREMENTS.md | FR-37 / FR-82 / FR-95 / NFR-8 | 更新する |
| docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md | Integrationの後続更新図と説明 | 更新する |
| docs/TEST_STRATEGY.md | 実LLM / 実DBの検証範囲 | 更新する |
| spec/personal-agent-concept-design-restructured-v2.md | commit後の保存判断専用という原則 | 更新しない。複数callを禁止していないため |
| src/application/experience-integration.ts | output contract、repair、対象別commit | 更新する |
| src/infrastructure/agent/experience-integration-harness.ts | 最小入力、責務別model call、prompt | 更新する |
| src/infrastructure/agent/tool-result-model-view.ts | 共通Tool投影のIntegration evidence選別 | 更新する |
| src/infrastructure/persistence/postgres-experience-integration.ts | 部分結果のapply / audit | 更新する |
| tests/unit/experience-integration.test.ts | 契約、no-op、対象別repair | 更新する |
| tests/live/ | `.env.shiro`でのread-only replay | 更新する |

## Scope

- Integration専用の最小入力viewを作る。全Self、全Concern、全Relationship、
  文脈取得用Tool結果をモデルへ渡さない。
- ToolRegistryの既存共通投影を拡張し、Eventの経験根拠になり得るTool結果だけを
  Integrationへ渡す。Integrationだけの独自投影は作らない。
- Event Experience / Memory candidates、Relationship、Mood、Focus Concernを
  責務別の小さなJSON schemaとLLM callへ分ける。
- `memories`が欠落した場合は保存候補なしとしてRuntimeが空配列に正規化する。
  `memory`や`relationships`等の旧・類推fieldを互換受理しない。
- `target`と`perspective`の許可literalを各Memory出力の短いprompt・descriptionで
  明示する。
- 一部の後続対象がrepair後も不正でも、独立した正常対象をcommitできるようにする。
- `.env.shiro`を起動時と同じ方法で読み、保存済み`shiro` RunをDB更新なしで
  複数回replayするgated live testを追加する。

## Out of scope

- Agent CoreのMeaning / Feeling / Desire / Actionの分割。
- MemoryWriteService、Reflection、Tool監査の永続構造変更。
- 旧fieldを文字列置換で受理する互換parser。

## Implementation notes

- 各callは同じsource Eventに由来するID-freeな最小viewだけを使い、通常Toolを
  呼ばない。対象別のLLM call数はNFR-21の軽量call予算に含める。
- Event Experienceは必須、Memory候補はno-op可能、Relationship / Mood /
  Focus Concernは条件付きcallとする。
- source Eventの監査、Integration request、対象別のapply / failureは既存の
  transaction境界と監査を保つ。schema migrationは行わない。

## Acceptance criteria

- [x] FR-37：Integration入力は共通Tool投影を使い、文脈取得だけのTool結果を
  経験根拠として渡さない。
- [x] FR-82：Event Experience、Memory、Relationship、Moodはそれぞれ必要な
  最小入力と説明付きJSON schemaだけを使う。
- [x] FR-82：`memories`の欠落は空候補へ正規化するが、旧・類推fieldはstrictに拒否する。
- [x] FR-95：Focus ConcernはRuntime束縛済みの一件だけを別schemaで判定する。
- [x] NFR-8：対象別の失敗は正常なExperience / Memory等を巻き戻さず、初回Action /
  Outboxを巻き戻さない。
- [x] NFR-21：対象別の軽量call数と入力上限を検証する。
- [x] NFR-23：すべての対象別構造出力とrepairはJSONだけを扱う。
- [x] 正の文書とテスト戦略が実装と一致する。
- [x] `spec-analyze change`にCRITICAL / HIGHがない。

## Tests

- FR-37：文脈取得ToolだけのRunがIntegration evidenceへ入らない。
- FR-82：最小view、必須Event Experience、Memory no-op、各schemaのliteralを検証する。
- FR-95：Focus Concernの対象外出力をcommitしない。
- NFR-8：一対象のrepair失敗でも他の正常対象が一度だけcommitされる。
- NFR-21：各対象callの入力・call数が上限内である。
- NFR-23：対象別のJSON repairがJSON以外を受理しない。
- FR-82, NFR-8：`shiro`保存Runを実際の起動設定でread-only replayするgated live test。

## 上流への反映

| 文書 | 反映内容 | 状態 |
|---|---|---|
| docs/REQUIREMENTS.md | 最小入力、対象別Integration、Memory no-op、部分失敗 | 未反映 |
| docs/AGENT_EVENT_AND_EXPERIENCE_OVERVIEW.md | 後続保存判断の分割 | 未反映 |
| docs/TEST_STRATEGY.md | 実LLM replay検証 | 未反映 |
| spec/personal-agent-concept-design-restructured-v2.md | 変更不要 | 不要 |

## 実装メモ

- Event Experienceを必須、Memory / Relationship / Mood / Focus Concernを対象別の小さいJSON callへ分割した。各任意対象は初回と同じ小入力で一度だけJSON repairを行い、なお不正ならno-opとして記録する。
- IntegrationのTool evidenceは共通`ToolRegistry`投影を再利用し、明示的な事実根拠だけを最大6件に限定した。
- `memories`はmodel向けcallでは必ず配列を返し、集約Runtimeだけが旧record又は部分結果の欠落を空配列に正規化する。
- 検証：`pnpm typecheck`、対象ESLint、`pnpm test -- tests/unit/experience-integration.test.ts`（314 tests）、実DB・実LLMによる`LIVE_SHIRO_EXPERIENCE_INTEGRATION_REPLAY=true ./node_modules/.bin/vitest run tests/live/ollama-experience-integration-replay.test.ts --config vitest.live.config.ts --reporter=verbose`（1 test）。
- 仕様照合：`docs/work/analyze/2026-11-26-change-099.md`。CRITICAL / HIGHなし。
